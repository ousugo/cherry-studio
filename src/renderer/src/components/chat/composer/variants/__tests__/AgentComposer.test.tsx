import type * as InputbarToolsProviderModule from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import type { FileMetadata } from '@renderer/types'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18nextModule from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import AgentComposer from '../AgentComposer'

const mocks = vi.hoisted(() => ({
  draftText: 'hello',
  files: [] as FileMetadata[],
  modelLookupId: undefined as UniqueModelId | undefined,
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setFiles: vi.fn(),
  surfaceProps: undefined as ComposerSurfaceProps | undefined
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

vi.mock('@renderer/components/chat/composer/ComposerSurface', async () => {
  const { InputbarToolsProvider } = await vi.importActual<typeof InputbarToolsProviderModule>(
    '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
  )

  return {
    InputbarToolsProvider,
    default: (props: ComposerSurfaceProps) => {
      mocks.surfaceProps = props
      return (
        <div>
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
  })
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      accessiblePaths: ['/workspace']
    }
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (id: UniqueModelId) => {
    mocks.modelLookupId = id
    return { model }
  }
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

vi.mock('@renderer/pages/home/Inputbar/context/InputbarToolsProvider', async () => {
  const actual = await vi.importActual<typeof InputbarToolsProviderModule>(
    '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
  )

  return {
    ...actual,
    useInputbarToolsState: () => ({
      files: mocks.files,
      mentionedModels: [],
      selectedKnowledgeBases: [],
      isExpanded: false,
      couldAddImageFile: false,
      couldMentionNotVisionModel: true,
      extensions: []
    }),
    useInputbarToolsDispatch: () => ({
      setFiles: mocks.setFiles,
      resizeTextArea: vi.fn(),
      addNewTopic: vi.fn(),
      clearTopic: vi.fn(),
      onNewContext: vi.fn(),
      onTextChange: vi.fn(),
      toggleExpanded: vi.fn(),
      toolsRegistry: {
        registerRootMenu: vi.fn(() => vi.fn()),
        registerTrigger: vi.fn(() => vi.fn())
      },
      triggers: {
        emit: vi.fn(),
        getRootMenu: vi.fn(() => [])
      }
    }),
    useInputbarToolsInternalDispatch: () => ({
      setCouldAddImageFile: vi.fn(),
      setExtensions: vi.fn()
    })
  }
})

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
    mocks.setFiles.mockReset()
    mocks.surfaceProps = undefined
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
    expect(mocks.surfaceProps?.model).toBe(model)
    expect(mocks.surfaceProps?.assistant?.modelId).toBe('anthropic::claude-sonnet-4-5')
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
})
