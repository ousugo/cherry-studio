import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import type { Assistant } from '@renderer/types'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({ agent: undefined })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ mcpServers: [] })
}))

import { TopicType } from '../../types'
import { buildMcpStatusItems, createMcpStatusLauncher } from '../mcpStatusTool'

const translations: Record<string, string> = {
  'settings.mcp.runtimeStatus.connected': 'Connected',
  'settings.mcp.runtimeStatus.connecting': 'Connecting',
  'settings.mcp.runtimeStatus.disabled': 'Disabled',
  'settings.mcp.runtimeStatus.error': 'Error',
  'settings.quickPanel.mcp.disabled': 'MCP is disabled for this assistant'
}

const t = ((key: string, fallback?: string) => translations[key] ?? fallback ?? key) as any

const server = (overrides: Partial<MCPServer> & Pick<MCPServer, 'id' | 'name' | 'isActive'>): MCPServer =>
  ({
    type: 'stdio',
    ...overrides
  }) as MCPServer

const status = (state: McpRuntimeStatus['state']): McpRuntimeStatus => ({
  state,
  lastCheckedAt: 1
})

describe('mcpStatusTool', () => {
  it('builds chat auto mode rows from active servers only', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'auto' },
        mcpServerIds: ['manual-only']
      } as Assistant,
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('connected') },
      scope: TopicType.Chat,
      t
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      label: 'filesystem',
      description: 'Connected'
    })
    expect(items[0].suffix).toBeUndefined()
  })

  it('builds chat manual mode rows from assistant bindings and shows inactive servers as disabled', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'manual' },
        mcpServerIds: ['inactive', 'active']
      } as Assistant,
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('connecting'), inactive: status('connected') },
      scope: TopicType.Chat,
      t
    })

    expect(items.map((item) => item.label)).toEqual(['search', 'filesystem'])
    expect(items[0]).toMatchObject({
      description: 'Disabled'
    })
    expect(items[0].suffix).toBeUndefined()
    expect(items[1]).toMatchObject({
      description: 'Connecting'
    })
    expect(items[1].suffix).toBeUndefined()
  })

  it('builds a chat disabled empty state', () => {
    const items = buildMcpStatusItems({
      assistant: {
        settings: { mcpMode: 'disabled' },
        mcpServerIds: ['active']
      } as Assistant,
      mcpServers: [server({ id: 'active', name: 'filesystem', isActive: true })],
      mcpStatuses: {},
      scope: TopicType.Chat,
      t
    })

    expect(items).toEqual([expect.objectContaining({ label: 'MCP is disabled for this assistant', disabled: true })])
  })

  it('builds session rows from the current agent bindings', () => {
    const items = buildMcpStatusItems({
      agent: { mcps: ['inactive', 'active'] },
      mcpServers: [
        server({ id: 'active', name: 'filesystem', isActive: true }),
        server({ id: 'inactive', name: 'search', isActive: false })
      ],
      mcpStatuses: { active: status('error') },
      scope: TopicType.Session,
      t
    })

    expect(items.map((item) => item.label)).toEqual(['search', 'filesystem'])
    expect(items[0]).toMatchObject({ description: 'Disabled' })
    expect(items[1]).toMatchObject({ description: 'Error' })
    expect(items[0].suffix).toBeUndefined()
    expect(items[1].suffix).toBeUndefined()
  })

  it('registers a root-panel-only launcher that opens a read-only MCP panel and clears typed query text', () => {
    const items = [server({ id: 'active', name: 'filesystem', isActive: true })].map((mcpServer) => ({
      id: mcpServer.id,
      label: mcpServer.name,
      icon: 'mcp'
    }))
    const launcher = createMcpStatusLauncher(items, t)
    const quickPanel = { open: vi.fn() }
    const inputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 4,
      getText: () => '/mcp',
      insertText: vi.fn()
    }

    expect(launcher).toMatchObject({
      id: 'mcp-status',
      sources: ['root-panel'],
      order: 50
    })

    launcher.action?.({
      quickPanel,
      inputAdapter,
      queryAnchor: 0,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/mcp' }
    } as any)

    expect(inputAdapter.deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 4 })
    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        list: items,
        readOnly: true,
        symbol: QuickPanelReservedSymbol.McpStatus,
        title: 'MCP'
      })
    )
  })
})
