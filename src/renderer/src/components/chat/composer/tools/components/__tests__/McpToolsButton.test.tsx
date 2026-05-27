import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { McpToolsRuntime } from '../McpToolsButton'

const mocks = vi.hoisted(() => ({
  useAssistant: vi.fn(),
  useMcpServers: vi.fn(),
  useProvider: vi.fn(),
  useQuickPanel: vi.fn(),
  useTimer: vi.fn(),
  navigate: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: (...args: unknown[]) => mocks.useAssistant(...args)
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: (...args: unknown[]) => mocks.useMcpServers(...args)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: unknown[]) => mocks.useProvider(...args)
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: (...args: unknown[]) => mocks.useTimer(...args)
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelReservedSymbol: {
    Mcp: 'mcp',
    McpPrompt: 'mcp-prompt',
    McpResource: 'mcp-resource'
  },
  useQuickPanel: (...args: unknown[]) => mocks.useQuickPanel(...args)
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate
}))

vi.mock('antd', () => ({
  Form: {
    Item: ({ children }: { children: ReactNode }) => <>{children}</>,
    useForm: () => [
      {
        resetFields: vi.fn(),
        validateFields: vi.fn()
      }
    ]
  },
  Input: () => null
}))

const createLauncherApi = (): ToolLauncherApi => ({
  registerLaunchers: vi.fn(() => vi.fn())
})

describe('McpToolsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(global.window as any).api = {
      mcp: {
        listPrompts: vi.fn(async () => []),
        listResources: vi.fn(async () => [])
      }
    }

    mocks.useAssistant.mockReturnValue({
      assistant: {
        id: 'assistant-1',
        settings: { mcpMode: 'disabled' },
        mcpServerIds: []
      },
      model: {
        id: 'model-1',
        providerId: 'provider-1',
        name: 'Model'
      },
      updateAssistant: vi.fn()
    })
    mocks.useMcpServers.mockReturnValue({ mcpServers: [] })
    mocks.useProvider.mockReturnValue({ provider: undefined })
    mocks.useQuickPanel.mockReturnValue({
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    })
    mocks.useTimer.mockReturnValue({
      setTimeoutTimer: (_key: string, callback: () => void) => callback()
    })
  })

  it('keeps MCP mode in the plus menu and MCP prompt/resource entries in the root panel', async () => {
    const launcher = createLauncherApi()

    render(
      <McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={vi.fn()} resizeTextArea={vi.fn()} />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    const modeLauncher = launchers.find((item) => item.id === 'mcp-tools')

    expect(modeLauncher?.sources).toEqual(['popover'])
    expect(modeLauncher?.submenu?.map((item) => item.id)).toEqual([
      'mcp-mode-disabled',
      'mcp-mode-auto',
      'mcp-mode-manual'
    ])
    expect(modeLauncher?.submenu?.every((item) => item.sources?.includes('root-panel'))).toBe(true)
    expect(launchers.find((item) => item.id === 'mcp-prompts')?.sources).toEqual(['root-panel'])
    expect(launchers.find((item) => item.id === 'mcp-resources')?.sources).toEqual(['root-panel'])
  })

  it('opens the manual server picker from the plus-menu manual mode item', async () => {
    const launcher = createLauncherApi()
    const quickPanel = {
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    }
    mocks.useQuickPanel.mockReturnValue(quickPanel)
    mocks.useMcpServers.mockReturnValue({
      mcpServers: [
        {
          id: 'server-a',
          name: 'Filesystem',
          description: 'Local files',
          isActive: true
        },
        {
          id: 'server-b',
          name: 'GitHub',
          baseUrl: 'https://github.example/mcp',
          isActive: true
        }
      ]
    })

    render(
      <McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={vi.fn()} resizeTextArea={vi.fn()} />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    const modeLauncher = launchers.find((item) => item.id === 'mcp-tools')
    const manualModeItem = modeLauncher?.submenu?.find((item) => item.id === 'mcp-mode-manual')

    manualModeItem?.action?.({} as never)

    expect(quickPanel.open).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'mcp',
        multiple: true,
        list: expect.arrayContaining([
          expect.objectContaining({ label: 'Filesystem', isSelected: false }),
          expect.objectContaining({ label: 'GitHub', isSelected: false })
        ])
      })
    )
  })
})
