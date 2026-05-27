import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
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

const createInputAdapter = (): QuickPanelInputAdapter => ({
  deleteTriggerRange: vi.fn(),
  focus: vi.fn(),
  getCursorOffset: vi.fn(() => 0),
  getText: vi.fn(() => ''),
  insertText: vi.fn(),
  insertToken: vi.fn()
})

describe('McpToolsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    ;(global.window as any).api = {
      mcp: {
        getPrompt: vi.fn(async ({ name }: { name: string }) => `${name} body`),
        getResource: vi.fn(async ({ uri }: { uri: string }) => ({ text: `${uri} body`, uri })),
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
        id: 'provider-1::model-1',
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

    render(<McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={vi.fn()} />)

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    const modeLauncher = launchers.find((item) => item.id === 'mcp-tools')
    const promptLauncher = launchers.find((item) => item.id === 'mcp-prompts')
    const resourceLauncher = launchers.find((item) => item.id === 'mcp-resources')

    expect(modeLauncher?.sources).toEqual(['popover'])
    expect(modeLauncher?.order).toBe(90)
    expect(modeLauncher?.submenu?.map((item) => item.id)).toEqual([
      'mcp-mode-disabled',
      'mcp-mode-auto',
      'mcp-mode-manual'
    ])
    expect(modeLauncher?.submenu?.map((item) => item.order)).toEqual([90, 90.01, 90.02])
    expect(modeLauncher?.submenu?.every((item) => item.sources?.includes('popover'))).toBe(true)
    expect(modeLauncher?.submenu?.every((item) => item.sources?.includes('root-panel'))).toBe(true)
    expect(promptLauncher?.sources).toEqual(['root-panel'])
    expect(promptLauncher?.order).toBe(91)
    expect(resourceLauncher?.sources).toEqual(['root-panel'])
    expect(resourceLauncher?.order).toBe(92)
  })

  it('opens the manual server picker from the plus-menu manual mode item', async () => {
    const launcher = createLauncherApi()
    const updateAssistant = vi.fn()
    const quickPanel = {
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    }
    mocks.useAssistant.mockReturnValue({
      assistant: {
        id: 'assistant-1',
        settings: { mcpMode: 'disabled' },
        mcpServerIds: []
      },
      model: {
        id: 'provider-1::model-1',
        providerId: 'provider-1',
        name: 'Model'
      },
      updateAssistant
    })
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

    render(<McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={vi.fn()} />)

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

    updateAssistant.mockClear()
    const panelOptions = quickPanel.open.mock.calls[0][0]
    panelOptions.list[0].action({} as never)

    expect(updateAssistant).toHaveBeenCalledWith({
      mcpServerIds: ['server-a'],
      settings: { mcpMode: 'manual' }
    })
  })

  it('does not register or fetch root-panel prompt/resource launchers when MCP tool-use is unavailable', async () => {
    const launcher = createLauncherApi()
    mocks.useMcpServers.mockReturnValue({
      mcpServers: [
        {
          id: 'server-a',
          name: 'Filesystem',
          isActive: true
        }
      ]
    })

    render(
      <McpToolsRuntime
        assistantId="assistant-1"
        launcher={launcher}
        setInputValue={vi.fn()}
        disabled
        disabledReason="Requires tool use"
      />
    )

    await waitFor(() => expect(launcher.registerLaunchers).toHaveBeenCalled())

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls[0][0]
    expect(launchers.map((item) => item.id)).toEqual(['mcp-tools'])
    expect(launchers[0]).toEqual(
      expect.objectContaining({
        disabled: true,
        disabledReason: 'Requires tool use'
      })
    )
    expect(window.api.mcp.listPrompts).not.toHaveBeenCalled()
    expect(window.api.mcp.listResources).not.toHaveBeenCalled()
  })

  it('inserts multiple MCP prompt selections as composer tokens without text fallback', async () => {
    const launcher = createLauncherApi()
    const quickPanel = {
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    }
    const inputAdapter = createInputAdapter()
    const setInputValue = vi.fn()

    mocks.useQuickPanel.mockReturnValue(quickPanel)
    mocks.useMcpServers.mockReturnValue({
      mcpServers: [
        {
          id: 'server-a',
          name: 'Filesystem',
          isActive: true
        }
      ]
    })
    ;(window as any).api.mcp.listPrompts = vi.fn(async () => [
      { serverId: 'server-a', serverName: 'Filesystem', name: 'Prompt A', description: 'First prompt' },
      { serverId: 'server-a', serverName: 'Filesystem', name: 'Prompt B', description: 'Second prompt' }
    ])

    render(<McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={setInputValue} />)

    await waitFor(() => expect((window as any).api.mcp.listPrompts).toHaveBeenCalled())
    await waitFor(() => expect(vi.mocked(launcher.registerLaunchers).mock.calls.length).toBeGreaterThan(1))

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls.at(-1)?.[0] ?? []
    const promptLauncher = launchers.find((item) => item.id === 'mcp-prompts')
    promptLauncher?.action?.({
      inputAdapter,
      parentPanel: { list: [], symbol: '/' },
      queryAnchor: 0,
      quickPanel: quickPanel as never,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/mcp' }
    })

    await waitFor(() =>
      expect(quickPanel.open).toHaveBeenCalledWith(
        expect.objectContaining({
          multiple: true,
          symbol: 'mcp-prompt',
          list: expect.arrayContaining([
            expect.objectContaining({ label: 'Prompt A' }),
            expect.objectContaining({ label: 'Prompt B' })
          ])
        })
      )
    )

    const panelOptions = quickPanel.open.mock.calls.at(-1)?.[0]
    panelOptions.list[0].action({ inputAdapter } as never)
    panelOptions.list[1].action({ inputAdapter } as never)

    await waitFor(() => expect(inputAdapter.insertToken).toHaveBeenCalledTimes(2))
    expect(inputAdapter.insertToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'mcpPrompt:server-a:Prompt A',
        kind: 'mcpPrompt',
        promptText: 'Prompt A body'
      })
    )
    expect(inputAdapter.insertToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'mcpPrompt:server-a:Prompt B',
        kind: 'mcpPrompt',
        promptText: 'Prompt B body'
      })
    )
    expect(setInputValue).not.toHaveBeenCalled()
  })

  it('inserts multiple MCP resource selections as composer tokens without text fallback', async () => {
    const launcher = createLauncherApi()
    const quickPanel = {
      close: vi.fn(),
      isVisible: false,
      open: vi.fn(),
      symbol: '',
      updateList: vi.fn()
    }
    const inputAdapter = createInputAdapter()
    const setInputValue = vi.fn()

    mocks.useQuickPanel.mockReturnValue(quickPanel)
    mocks.useMcpServers.mockReturnValue({
      mcpServers: [
        {
          id: 'server-a',
          name: 'Filesystem',
          isActive: true
        }
      ]
    })
    ;(window as any).api.mcp.listResources = vi.fn(async () => [
      { serverId: 'server-a', serverName: 'Filesystem', name: 'Resource A', uri: 'file://a', mimeType: 'text/plain' },
      { serverId: 'server-a', serverName: 'Filesystem', name: 'Resource B', uri: 'file://b', mimeType: 'text/plain' }
    ])

    render(<McpToolsRuntime assistantId="assistant-1" launcher={launcher} setInputValue={setInputValue} />)

    await waitFor(() => expect((window as any).api.mcp.listResources).toHaveBeenCalled())
    await waitFor(() => expect(vi.mocked(launcher.registerLaunchers).mock.calls.length).toBeGreaterThan(1))

    const launchers = vi.mocked(launcher.registerLaunchers).mock.calls.at(-1)?.[0] ?? []
    const resourceLauncher = launchers.find((item) => item.id === 'mcp-resources')
    resourceLauncher?.action?.({
      inputAdapter,
      parentPanel: { list: [], symbol: '/' },
      queryAnchor: 0,
      quickPanel: quickPanel as never,
      source: 'root-panel',
      triggerInfo: { type: 'input', position: 0, originalText: '/mcp' }
    })

    await waitFor(() =>
      expect(quickPanel.open).toHaveBeenCalledWith(
        expect.objectContaining({
          multiple: true,
          symbol: 'mcp-resource',
          list: expect.arrayContaining([
            expect.objectContaining({ label: 'Resource A' }),
            expect.objectContaining({ label: 'Resource B' })
          ])
        })
      )
    )

    const panelOptions = quickPanel.open.mock.calls.at(-1)?.[0]
    panelOptions.list[0].action({ inputAdapter } as never)
    panelOptions.list[1].action({ inputAdapter } as never)

    await waitFor(() => expect(inputAdapter.insertToken).toHaveBeenCalledTimes(2))
    expect(inputAdapter.insertToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'mcpResource:server-a:file://a',
        kind: 'mcpResource',
        promptText: 'file://a body'
      })
    )
    expect(inputAdapter.insertToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'mcpResource:server-a:file://b',
        kind: 'mcpResource',
        promptText: 'file://b body'
      })
    )
    expect(setInputValue).not.toHaveBeenCalled()
  })
})
