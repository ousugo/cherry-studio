import { cacheService } from '@data/CacheService'
import type { FileMetadata, LocalSkill } from '@renderer/types'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import AgentComposer, { AgentHomeComposer } from '../AgentComposer'

const mocks = vi.hoisted(() => ({
  draftText: 'hello',
  files: [] as FileMetadata[],
  modelLookupId: undefined as UniqueModelId | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  getPathStatus: vi.fn(),
  updateModel: vi.fn(),
  updateSession: vi.fn(),
  setFiles: vi.fn(),
  enqueueDraft: vi.fn(),
  availableSkills: [] as LocalSkill[],
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  derivedToolState: undefined as { couldAddImageFile: boolean; extensions: string[] } | undefined,
  ipcListeners: new Map<string, (_event: unknown, payload: unknown) => void>(),
  ipcOn: vi.fn(),
  runtimeHostProps: undefined as
    | { assistant?: { modelId?: string | null }; model?: Model; session?: { agentId?: string } }
    | undefined
}))

const originalResizeObserver = globalThis.ResizeObserver

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  target?: Element
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const resizeObserverMockInstances: ResizeObserverMockInstance[] = []

const model = {
  id: 'anthropic::claude-sonnet-4-5',
  providerId: 'anthropic',
  apiModelId: 'claude-sonnet-4-5',
  name: 'Claude Sonnet 4.5',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

const file = {
  id: 'file-1',
  name: 'notes.md',
  origin_name: 'notes.md',
  path: '/tmp/notes.md'
} as FileMetadata

vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn(() => ''),
    setCasual: vi.fn()
  }
}))

vi.mock('@renderer/components/chat/composer/ComposerSurface', () => {
  function MockComposerSurface(props: ComposerSurfaceProps) {
    useEffect(() => {
      props.onActionsChange?.({
        onTextChange: (updater) => {
          const nextText = typeof updater === 'function' ? updater(props.text) : updater
          props.onTextChange(nextText)
        },
        toggleExpanded: vi.fn(),
        removeToken: vi.fn()
      })
    }, [props])

    mocks.surfaceProps = props
    return (
      <div>
        <div data-testid="composer-left-controls">{props.renderLeftControls?.(undefined)}</div>
        <div data-testid="composer-below-controls">{props.renderBelowControls?.(undefined)}</div>
        <button
          type="button"
          onClick={() =>
            props.onSendDraft({
              text: mocks.draftText,
              tokens: mocks.files.map((currentFile, index) => ({
                id: `file:${currentFile.id}`,
                kind: 'file',
                label: currentFile.name,
                payload: currentFile,
                index,
                textOffset: mocks.draftText.length
              }))
            })
          }>
          send
        </button>
        <button type="button" onClick={() => props.onPause()}>
          pause
        </button>
      </div>
    )
  }

  return {
    default: MockComposerSurface
  }
})

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolDerivedStateProvider: ({
    children,
    couldAddImageFile,
    extensions
  }: {
    children: ReactNode
    couldAddImageFile: boolean
    extensions: string[]
  }) => {
    mocks.derivedToolState = { couldAddImageFile, extensions }
    return <>{children}</>
  },
  ComposerToolRuntimeHost: (props: {
    assistant?: { modelId?: string | null }
    model?: Model
    session?: { agentId?: string }
  }) => {
    mocks.runtimeHostProps = props
    return null
  },
  ComposerToolMenu: () => null,
  ComposerActiveToolControls: () => null,
  useComposerToolState: () => ({
    files: mocks.files,
    mentionedModels: [],
    selectedKnowledgeBases: [],
    isExpanded: false,
    couldAddImageFile: false,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setIsExpanded: vi.fn(),
    addNewTopic: vi.fn(),
    onTextChange: vi.fn(),
    toolsRegistry: {
      registerLaunchers: vi.fn(() => vi.fn())
    },
    triggers: {
      getLaunchers: vi.fn(() => []),
      version: 0
    }
  }),
  useComposerToolLauncherController: () => ({
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  }),
  useComposerToolLauncherActions: () => ({
    getLaunchers: vi.fn(() => []),
    dispatchLauncher: vi.fn()
  })
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: {
      id: 'agent-1',
      name: 'Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet-4-5',
      modelName: 'Claude Sonnet 4.5',
      instructions: 'Follow instructions',
      configuration: {}
    }
  }),
  useUpdateAgent: () => ({ updateModel: mocks.updateModel })
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      accessiblePaths: ['/workspace'],
      workspaceId: 'workspace-1',
      workspace: {
        id: 'workspace-1',
        name: 'Workspace 1',
        path: '/workspace',
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
  }),
  useUpdateSession: () => ({ updateSession: mocks.updateSession })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (id: UniqueModelId) => {
    mocks.modelLookupId = id
    return { model }
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Anthropic'
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useAvailableSkills: () => ({
    skills: mocks.availableSkills,
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/Selector', () => ({
  AgentSelector: ({ onChange, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('agent-2')}>
        select agent 2
      </button>
    </div>
  ),
  ModelSelector: ({ onSelect, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect({ id: 'anthropic::claude-opus-4', name: 'Claude Opus 4' })}>
        select model 2
      </button>
    </div>
  ),
  WorkspaceSelector: ({ onChange, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('workspace-2')}>
        select workspace 2
      </button>
    </div>
  )
}))

vi.mock('@renderer/pages/agents/AgentSettings/shared', () => ({
  AgentLabel: ({ agent }: any) => <span>{agent.name}</span>,
  isSoulModeEnabled: () => false
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'app.spell_check.enabled': true,
      'chat.message.font_size': 14,
      'chat.narrow_mode': false,
      'chat.input.send_message_shortcut': 'Enter'
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn()
  })
}))

vi.mock('@renderer/components/chat/composer/useComposerMessageQueue', () => ({
  useComposerMessageQueue: () => ({
    draftItems: [],
    pendingItems: [],
    hasDraftItems: false,
    enqueueDraft: mocks.enqueueDraft,
    removeDraft: vi.fn(),
    reorderDraft: vi.fn(),
    claimNextDraft: vi.fn(),
    completeDraft: vi.fn(),
    failDraft: vi.fn(),
    removePending: vi.fn(),
    reorderPending: vi.fn()
  })
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

describe('AgentComposer', () => {
  beforeEach(() => {
    resizeObserverMockInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance: ResizeObserverMockInstance = {
        callback,
        observe: vi.fn((target: Element) => {
          instance.target = target
        }),
        disconnect: vi.fn()
      }
      resizeObserverMockInstances.push(instance)

      return {
        observe: instance.observe,
        disconnect: instance.disconnect
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver

    mocks.draftText = 'hello'
    mocks.files = []
    mocks.modelLookupId = undefined
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue(undefined)
    mocks.stop.mockReset()
    mocks.stop.mockResolvedValue(undefined)
    mocks.getPathStatus.mockReset()
    mocks.getPathStatus.mockImplementation(() => new Promise(() => undefined))
    window.api = {
      ...window.api,
      file: {
        ...window.api.file,
        getPathStatus: mocks.getPathStatus
      }
    }
    mocks.updateModel.mockReset()
    mocks.updateSession.mockReset()
    mocks.setFiles.mockReset()
    mocks.enqueueDraft.mockReset()
    mocks.enqueueDraft.mockResolvedValue(undefined)
    mocks.availableSkills = []
    mocks.surfaceProps = undefined
    mocks.derivedToolState = undefined
    mocks.runtimeHostProps = undefined
    mocks.ipcListeners.clear()
    mocks.ipcOn.mockReset()
    mocks.ipcOn.mockImplementation((channel: string, listener: (_event: unknown, payload: unknown) => void) => {
      mocks.ipcListeners.set(channel, listener)
      return () => mocks.ipcListeners.delete(channel)
    })
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        ipcRenderer: {
          on: mocks.ipcOn
        }
      }
    })
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('resolves the agent model through the v2 UniqueModelId', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.modelLookupId).toBe('anthropic::claude-sonnet-4-5')
    expect(mocks.runtimeHostProps?.model).toBe(model)
    expect(mocks.runtimeHostProps?.session?.agentId).toBe('agent-1')
  })

  it('passes attachment capabilities through the provider without effect mirroring', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(mocks.derivedToolState).toEqual({
      couldAddImageFile: false,
      extensions: mocks.surfaceProps?.supportedExts
    })
  })

  it('passes available skills as additional slash panel rows', () => {
    mocks.availableSkills = [
      {
        name: 'pdf',
        description: 'Read and analyze PDFs',
        filename: 'pdf'
      }
    ]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    expect(skillItem).toEqual(
      expect.objectContaining({
        id: 'skill:pdf',
        label: 'pdf',
        description: 'Read and analyze PDFs',
        suffix: 'plugins.skills',
        filterText: expect.stringContaining('pdf Read and analyze PDFs plugins.skills')
      })
    )

    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      insertToken: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    expect(inputAdapter.insertText).toHaveBeenCalledWith('Use the pdf skill. ')
    expect(inputAdapter.insertToken).not.toHaveBeenCalled()
    expect(inputAdapter.focus).toHaveBeenCalled()
  })

  it('inserts skill prompt text without token support', () => {
    mocks.availableSkills = [
      {
        name: 'pdf',
        description: 'Read and analyze PDFs',
        filename: 'pdf'
      }
    ]

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    const skillItem = mocks.surfaceProps?.rootPanelAdditionalItems?.[0]
    const inputAdapter = {
      getText: vi.fn(() => ''),
      insertText: vi.fn(),
      deleteTriggerRange: vi.fn(),
      focus: vi.fn()
    }
    skillItem?.action?.({
      context: {} as any,
      action: 'enter',
      item: skillItem,
      inputAdapter
    })

    expect(inputAdapter.insertText).toHaveBeenCalledWith('Use the pdf skill. ')
    expect(inputAdapter.focus).toHaveBeenCalled()
  })

  it('sends a draft that only contains skill prompt text', () => {
    mocks.draftText = 'Use the pdf skill.'

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'Use the pdf skill.' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [
            expect.objectContaining({
              type: 'text',
              text: 'Use the pdf skill.'
            })
          ]
        }
      }
    )
    expect(mocks.sendMessage.mock.calls[0][1].body.userMessageParts[0]).not.toHaveProperty('providerMetadata')
    expect(mocks.enqueueDraft).not.toHaveBeenCalled()
  })

  it('bridges file tokens into the existing agent session message text protocol', () => {
    mocks.files = [file]
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [
            {
              type: 'text',
              text: 'hello',
              providerMetadata: {
                cherry: {
                  composer: {
                    version: 1,
                    tokens: [{ id: 'file:file-1', kind: 'file', label: 'notes.md', index: 0, textOffset: 5 }]
                  }
                }
              }
            },
            {
              type: 'file',
              url: '/tmp/notes.md',
              mediaType: 'application/octet-stream',
              filename: 'notes.md'
            }
          ]
        }
      }
    )
    expect(mocks.setFiles).toHaveBeenLastCalledWith([])
  })

  it('blocks sends while the parent session is switching', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
        sendDisabled
      />
    )

    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('common.loading')

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('calls the active stream stop handler when paused', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    fireEvent.click(screen.getByText('pause'))

    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })

  it('queues send drafts while the agent session is streaming', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming
      />
    )

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.enqueueDraft).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }))
  })

  it('appends quoted selected text from the main-window quote IPC', async () => {
    vi.mocked(cacheService.getCasual).mockReturnValue('Existing draft')

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() => {
      expect(mocks.ipcOn).toHaveBeenCalledWith(IpcChannel.App_QuoteToMain, expect.any(Function))
    })

    act(() => {
      mocks.ipcListeners.get(IpcChannel.App_QuoteToMain)?.({}, 'Selected message text')
    })

    await waitFor(() => {
      expect(mocks.surfaceProps?.text).toBe('Existing draft\n<blockquote>\n\nSelected message text\n</blockquote>\n\n')
    })
  })

  it('updates the active session agent from the composer toolbar', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select agent 2'))

    expect(mocks.updateSession).toHaveBeenCalledWith(
      { id: 'session-1', agentId: 'agent-2' },
      { showSuccessToast: false }
    )
  })

  it('releases draft session agent changes to the provided handler', () => {
    const onAgentChange = vi.fn()

    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onAgentChange={onAgentChange}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select agent 2'))

    expect(onAgentChange).toHaveBeenCalledWith('agent-2')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('updates the active agent model from the composer toolbar', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.updateModel).toHaveBeenCalledWith('agent-1', 'anthropic::claude-opus-4', {
      showSuccessToast: false
    })
  })

  it('shows only icons in the input bottom toolbar when it is narrow', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
      expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).toHaveClass('sr-only')
    })
  })

  it('keeps input bottom toolbar labels visible when the toolbar fits', async () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await notifyComposerBottomToolbarWidth(420, 420)

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')
  })

  it('renders agent and model selectors below the surface in temporary home mode', () => {
    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Agent')
    const belowControls = screen.getByTestId('composer-below-controls')
    expect(belowControls).toHaveTextContent('Workspace 1')
    expect(belowControls).toHaveTextContent('Agent')
    expect(belowControls).toHaveTextContent('Claude Sonnet 4.5 | Anthropic')

    const belowText = belowControls.textContent ?? ''
    expect(belowText.indexOf('Agent')).toBeLessThan(belowText.indexOf('Claude Sonnet 4.5 | Anthropic'))
    expect(belowText.indexOf('Claude Sonnet 4.5 | Anthropic')).toBeLessThan(belowText.indexOf('Workspace 1'))
  })

  it('shows only icons in the temporary home bottom toolbar when it is narrow', async () => {
    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByText('Agent')).not.toHaveClass('sr-only')
    expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).not.toHaveClass('sr-only')
    expect(screen.getByText('Workspace 1')).not.toHaveClass('sr-only')

    await notifyComposerBottomToolbarWidth(420)

    await waitFor(() => {
      expect(screen.getByText('Agent')).toHaveClass('sr-only')
      expect(screen.getByText('Claude Sonnet 4.5 | Anthropic')).toHaveClass('sr-only')
      expect(screen.getByText('Workspace 1')).toHaveClass('sr-only')
    })
  })

  it('does not render the workspace selector in docked composer mode', () => {
    render(
      <AgentComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Workspace 1')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Workspace 1')
  })

  it('releases draft workspace changes to the provided handler', () => {
    const onWorkspaceChange = vi.fn()

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        onWorkspaceChange={onWorkspaceChange}
        isStreaming={false}
      />
    )

    fireEvent.click(screen.getByText('select workspace 2'))

    expect(onWorkspaceChange).toHaveBeenCalledWith('workspace-2')
  })

  it('does not block sends when workspace status preflight fails', async () => {
    mocks.getPathStatus.mockRejectedValueOnce(new Error('preflight unavailable'))

    render(
      <AgentHomeComposer
        agentId="agent-1"
        sessionId="session-1"
        sendMessage={mocks.sendMessage}
        stop={mocks.stop}
        isStreaming={false}
      />
    )

    await waitFor(() =>
      expect(mocks.getPathStatus).toHaveBeenCalledWith({ path: '/workspace', expectedKind: 'directory' })
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('send'))

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
  })
})

async function notifyComposerBottomToolbarWidth(width: number, scrollWidth = width + 240) {
  await waitFor(() => {
    expect(
      resizeObserverMockInstances.some((instance) =>
        String(instance.target?.getAttribute('class') ?? '').includes('max-w-full')
      )
    ).toBe(true)
  })

  const toolbarInstances = resizeObserverMockInstances.filter((instance) =>
    String(instance.target?.getAttribute('class') ?? '').includes('max-w-full')
  )
  if (toolbarInstances.length === 0) {
    throw new Error('Expected composer bottom toolbar to create a ResizeObserver')
  }

  act(() => {
    for (const instance of toolbarInstances) {
      Object.defineProperty(instance.target, 'clientWidth', { configurable: true, value: width })
      Object.defineProperty(instance.target, 'scrollWidth', { configurable: true, value: scrollWidth })
      instance.callback(
        [
          {
            contentRect: { width }
          } as ResizeObserverEntry
        ],
        {} as ResizeObserver
      )
    }
  })
}
