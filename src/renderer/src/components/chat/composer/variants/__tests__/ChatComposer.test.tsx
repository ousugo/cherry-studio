import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSurfaceProps } from '../../ComposerSurface'
import ChatComposer, { ChatHomeComposer } from '../ChatComposer'

const mocks = vi.hoisted(() => ({
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  setModel: vi.fn(),
  setDefaultModel: vi.fn(),
  setFiles: vi.fn(),
  setMentionedModels: vi.fn(),
  setSelectedKnowledgeBases: vi.fn(),
  setIsExpanded: vi.fn(),
  updateAssistant: vi.fn(),
  toastError: vi.fn(),
  shortcutHandlers: new Map<string, () => void>(),
  assistant: undefined as any,
  model: undefined as Model | undefined,
  surfaceProps: undefined as ComposerSurfaceProps | undefined
}))

const model = {
  id: 'provider::model-a',
  providerId: 'provider',
  apiModelId: 'model-a',
  name: 'Model A',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
} satisfies Model

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
          <div data-testid="composer-left-controls">{props.renderLeftControls?.(undefined)}</div>
          <div data-testid="composer-below-controls">{props.renderBelowControls?.(undefined)}</div>
        </div>
      )
    }
  }
})

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ComposerToolRuntimeHost: () => null,
  ComposerToolMenu: () => <button type="button">tool menu</button>,
  useComposerToolState: () => ({
    files: [],
    mentionedModels: [],
    selectedKnowledgeBases: [],
    isExpanded: false,
    couldAddImageFile: false,
    couldMentionNotVisionModel: true,
    extensions: []
  }),
  useComposerToolDispatch: () => ({
    setFiles: mocks.setFiles,
    setMentionedModels: mocks.setMentionedModels,
    setSelectedKnowledgeBases: mocks.setSelectedKnowledgeBases,
    setIsExpanded: mocks.setIsExpanded,
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

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/Selector', () => ({
  AssistantSelector: ({ onChange, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('assistant-2')}>
        select assistant 2
      </button>
    </div>
  ),
  ModelSelector: ({ onSelect, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect({ id: 'provider::model-b', name: 'Model B' })}>
        select model 2
      </button>
    </div>
  )
}))

vi.mock('@renderer/config/models', () => ({
  isGenerateImageModel: () => false,
  isGenerateImageModels: () => false,
  isVisionModel: () => false,
  isVisionModels: () => false
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: (key: string) => (key === 'chat.multi_select_mode' ? [false] : [false, vi.fn()])
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    const values: Record<string, unknown> = {
      'app.spell_check.enabled': true,
      'chat.message.font_size': 14,
      'chat.narrow_mode': false,
      'chat.input.quick_panel.triggers_enabled': true,
      'chat.input.send_message_shortcut': 'Enter'
    }
    return [values[key]]
  }
}))

vi.mock('@renderer/hooks/ChatWriteContext', () => ({
  useChatWrite: () => ({ pause: vi.fn() })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistant: mocks.assistant,
    isLoading: false,
    model: mocks.model,
    setModel: mocks.setModel,
    updateAssistant: mocks.updateAssistant
  }),
  useDefaultAssistant: () => ({
    assistant: {
      id: 'default-assistant',
      name: 'Default Assistant',
      emoji: 'D'
    }
  })
}))

vi.mock('@renderer/hooks/useKnowledgeBaseDataApi', () => ({
  useKnowledgeBases: () => ({ knowledgeBases: [] })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ setDefaultModel: mocks.setDefaultModel })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: (providerId?: string) => (providerId ? 'Provider' : undefined)
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: (key: string, handler: () => void) => {
    mocks.shortcutHandlers.set(key, handler)
  }
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicMutations: () => ({
    createTopic: mocks.createTopic,
    updateTopic: mocks.updateTopic
  })
}))

vi.mock('@renderer/hooks/useTopicAwaitingApproval', () => ({
  useTopicAwaitingApproval: () => false
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false })
}))

vi.mock('@shared/utils/model', () => ({
  isNonChatModel: () => false,
  isWebSearchModel: () => false
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)
    })
  }
})

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  type: 'chat'
} as any

describe('ChatComposer', () => {
  beforeEach(() => {
    mocks.createTopic.mockReset()
    mocks.updateTopic.mockReset()
    mocks.setModel.mockReset()
    mocks.setDefaultModel.mockReset()
    mocks.setFiles.mockReset()
    mocks.setMentionedModels.mockReset()
    mocks.setSelectedKnowledgeBases.mockReset()
    mocks.setIsExpanded.mockReset()
    mocks.updateAssistant.mockReset()
    mocks.toastError.mockReset()
    mocks.shortcutHandlers.clear()
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      emoji: 'A',
      settings: { enableWebSearch: true },
      knowledgeBaseIds: []
    }
    mocks.model = model
    mocks.surfaceProps = undefined
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
    })
  })

  it('renders the tool menu before assistant and model selectors', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('tool menu')).toBeInTheDocument()
    expect(screen.getByText('Assistant 1')).toBeInTheDocument()
    expect(screen.getByText('Model A | Provider')).toBeInTheDocument()
  })

  it('updates the topic assistant from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select assistant 2'))

    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-1', { assistantId: 'assistant-2' })
  })

  it('updates the assistant model from the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(
      { id: 'provider::model-b', name: 'Model B' },
      { enableWebSearch: false }
    )
  })

  it('shows model selection instead of a fallback model when the assistant has no configured model', () => {
    mocks.model = undefined

    render(<ChatComposer topic={topic} setActiveTopic={vi.fn()} onSend={vi.fn()} />)

    expect(screen.getByText('button.select_model')).toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
  })

  it('blocks send with a model-required toast when the assistant has no configured model', async () => {
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} setActiveTopic={vi.fn()} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('code.model_required')
  })

  it('routes new topic shortcuts through the explicit parent action', () => {
    const onNewTopic = vi.fn()
    render(<ChatComposer topic={topic} setActiveTopic={vi.fn()} onSend={vi.fn()} onNewTopic={onNewTopic} />)

    mocks.shortcutHandlers.get('topic.new')?.()

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
    expect(mocks.createTopic).not.toHaveBeenCalled()
  })

  it('renders selectors below the surface in temporary home mode', () => {
    render(<ChatHomeComposer topic={topic} setActiveTopic={vi.fn()} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('routes temporary home assistant changes to the temporary handler', () => {
    const onTemporaryAssistantChange = vi.fn()
    render(
      <ChatHomeComposer
        topic={topic}
        setActiveTopic={vi.fn()}
        onSend={vi.fn()}
        onTemporaryAssistantChange={onTemporaryAssistantChange}
      />
    )

    fireEvent.click(screen.getByText('select assistant 2'))

    expect(onTemporaryAssistantChange).toHaveBeenCalledWith('assistant-2')
    expect(mocks.updateTopic).not.toHaveBeenCalled()
  })
})
