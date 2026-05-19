import type { FileMetadata } from '@renderer/types'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import AgentComposer, { AgentHomeComposer } from '../AgentComposer'

const mocks = vi.hoisted(() => ({
  draftText: 'hello',
  files: [] as FileMetadata[],
  modelLookupId: undefined as UniqueModelId | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  updateModel: vi.fn(),
  updateSession: vi.fn(),
  setFiles: vi.fn(),
  surfaceProps: undefined as ComposerSurfaceProps | undefined,
  runtimeHostProps: undefined as { assistant?: { modelId?: string | null }; model?: Model } | undefined
}))

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
  return {
    default: (props: ComposerSurfaceProps) => {
      mocks.surfaceProps = props
      return (
        <div>
          <div data-testid="composer-top-content">{props.topContent}</div>
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
  }
})

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolRuntimeHost: (props: { assistant?: { modelId?: string | null }; model?: Model }) => {
    mocks.runtimeHostProps = props
    return null
  },
  ComposerToolMenu: () => null,
  useComposerToolState: () => ({
    files: mocks.files,
    mentionedModels: [],
    selectedKnowledgeBases: [],
    isExpanded: false,
    couldAddImageFile: false,
    couldMentionNotVisionModel: true,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setIsExpanded: vi.fn(),
    resizeTextArea: vi.fn(),
    addNewTopic: vi.fn(),
    onTextChange: vi.fn(),
    toggleExpanded: vi.fn(),
    toolsRegistry: {
      registerRootMenu: vi.fn(() => vi.fn()),
      registerLaunchers: vi.fn(() => vi.fn()),
      registerTrigger: vi.fn(() => vi.fn())
    },
    triggers: {
      emit: vi.fn(),
      getRootMenu: vi.fn(() => []),
      getLaunchers: vi.fn(() => [])
    }
  }),
  useComposerToolInternalDispatch: () => ({
    setCouldAddImageFile: vi.fn(),
    setExtensions: vi.fn()
  }),
  useComposerToolLauncherController: () => ({
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
      accessiblePaths: ['/workspace']
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
    mocks.draftText = 'hello'
    mocks.files = []
    mocks.modelLookupId = undefined
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue(undefined)
    mocks.stop.mockReset()
    mocks.stop.mockResolvedValue(undefined)
    mocks.updateModel.mockReset()
    mocks.updateSession.mockReset()
    mocks.setFiles.mockReset()
    mocks.surfaceProps = undefined
    mocks.runtimeHostProps = undefined
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
    expect(mocks.surfaceProps?.topContent).toBeUndefined()
    expect(mocks.runtimeHostProps?.model).toBe(model)
    expect(mocks.runtimeHostProps?.assistant?.modelId).toBe('anthropic::claude-sonnet-4-5')
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

    expect(screen.getByTestId('composer-top-content')).toHaveTextContent('agent.home.welcome_title')
    expect(mocks.surfaceProps?.topContent).toBeDefined()
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Agent')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Agent')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Claude Sonnet 4.5 | Anthropic')
  })
})
