import { cacheService } from '@data/CacheService'
import type { ComposerQueueItem } from '@shared/ai/transport'
import type { Model } from '@shared/data/types/model'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { isValidElement, type ReactNode } from 'react'
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
  mentionedModels: undefined as Model[] | undefined,
  assistant: undefined as any,
  model: undefined as Model | undefined,
  assistantLoading: false,
  modelPending: false,
  modelMissing: undefined as boolean | undefined,
  topicPending: false,
  draftItems: [] as ComposerQueueItem[],
  canSteerDraft: false,
  enqueueDraft: vi.fn(),
  completeDraft: vi.fn(),
  failDraft: vi.fn(),
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

const modelB = {
  id: 'provider::model-b',
  providerId: 'provider',
  apiModelId: 'model-b',
  name: 'Model B',
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
          <div data-testid="composer-top-content">{props.topContent}</div>
          <div data-testid="composer-left-controls">{props.renderLeftControls?.(undefined)}</div>
          <div data-testid="composer-below-controls">{props.renderBelowControls?.(undefined)}</div>
          {props.tokens.map((token) => (
            <button
              key={token.id}
              type="button"
              data-testid={`remove-token-${token.id}`}
              onClick={() => props.onTokenRemoveRequest?.({ kind: token.kind, tokenId: token.id })}>
              remove {token.label}
            </button>
          ))}
        </div>
      )
    }
  }
})

vi.mock('@renderer/components/chat/composer/ComposerToolRuntime', () => ({
  ComposerToolRuntimeProvider: ({
    children,
    initialState
  }: {
    children: ReactNode
    initialState?: { mentionedModels?: Model[] }
  }) => {
    if (mocks.mentionedModels === undefined) {
      mocks.mentionedModels = initialState?.mentionedModels ?? []
    }
    return <>{children}</>
  },
  ComposerToolRuntimeHost: () => null,
  ComposerToolMenu: () => <button type="button">tool menu</button>,
  ComposerActiveToolControls: () => null,
  useComposerToolState: () => ({
    files: [],
    mentionedModels: mocks.mentionedModels ?? [],
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
      registerLaunchers: vi.fn(() => vi.fn())
    },
    triggers: {
      getLaunchers: vi.fn(() => []),
      version: 0
    }
  }),
  useComposerToolInternalDispatch: () => ({
    setCouldAddImageFile: vi.fn(),
    setExtensions: vi.fn()
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

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/EmojiIcon', () => ({
  default: ({ emoji }: { emoji: string }) => <span>{emoji}</span>
}))

vi.mock('@renderer/components/Selector', () => ({
  AssistantSelector: ({ onChange, trigger, value }: any) => (
    <div data-testid="assistant-selector" data-value={value ?? ''}>
      {trigger}
      <button type="button" onClick={() => onChange('assistant-2')}>
        select assistant 2
      </button>
    </div>
  ),
  ModelSelector: ({
    onSelect,
    trigger,
    multiple,
    value,
    defaultMultiSelectMode,
    multiSelectMode,
    onMultiSelectModeChange
  }: any) => (
    <div
      data-testid="model-selector"
      data-multiple={String(multiple)}
      data-default-multi-select={String(Boolean(defaultMultiSelectMode))}
      data-multi-select-mode={String(Boolean(multiSelectMode))}
      data-value-count={Array.isArray(value) ? String(value.length) : ''}>
      {trigger}
      <button
        type="button"
        onClick={() => {
          onSelect(multiple ? [modelB] : modelB)
        }}>
        select model 2
      </button>
      {multiple ? (
        <>
          <button type="button" onClick={() => onMultiSelectModeChange?.(!multiSelectMode)}>
            toggle model multi select
          </button>
          <button type="button" onClick={() => onSelect([model, modelB])}>
            select models 1 and 2
          </button>
          <button type="button" onClick={() => onSelect([])}>
            clear model selection
          </button>
        </>
      ) : null}
    </div>
  )
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: () => false,
  isGenerateImageModel: () => false,
  isGenerateImageModels: () => false,
  isRerankModel: () => false,
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
    isLoading: mocks.assistantLoading,
    model: mocks.model,
    isModelPending: mocks.modelPending,
    isModelMissing: mocks.modelMissing ?? (!mocks.assistantLoading && !mocks.modelPending && !mocks.model),
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
  useDefaultModel: () => ({ setDefaultModel: mocks.setDefaultModel }),
  useModels: () => ({ models: [model, modelB] })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: () => 'Provider',
  useProviderDisplayName: (providerId?: string) => (providerId ? 'Provider' : undefined),
  useProviders: () => ({ providers: [{ id: 'provider', name: 'Provider' }] })
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
  useTopicAwaitingApproval: () => false,
  useTopicStreamStatus: () => ({ isPending: mocks.topicPending })
}))

vi.mock('@renderer/components/chat/composer/useComposerMessageQueue', () => ({
  useComposerMessageQueue: () => ({
    draftItems: mocks.draftItems,
    pendingItems: [],
    hasDraftItems: mocks.draftItems.length > 0,
    canSteerDraft: mocks.canSteerDraft,
    enqueueDraft: mocks.enqueueDraft,
    removeDraft: vi.fn(),
    reorderDraft: vi.fn(),
    claimNextDraft: vi.fn(),
    completeDraft: mocks.completeDraft,
    failDraft: mocks.failDraft,
    removePending: vi.fn(),
    reorderPending: vi.fn()
  })
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
      t: (key: string, options?: Record<string, unknown>) => {
        if (key === 'common.selectedItems') return `${options?.count ?? 0} selected`
        return String(options?.defaultValue ?? key)
      }
    })
  }
})

const topic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  type: 'chat'
} as any

const unlinkedTopic = {
  id: 'topic-unlinked',
  assistantId: undefined,
  type: 'chat'
} as any

const missingAssistantTopic = {
  id: 'topic-missing',
  assistantId: 'missing-assistant',
  type: 'chat'
} as any

describe('ChatComposer', () => {
  beforeEach(() => {
    vi.mocked(cacheService.getCasual).mockReset()
    vi.mocked(cacheService.getCasual).mockReturnValue('')
    vi.mocked(cacheService.setCasual).mockReset()
    mocks.createTopic.mockReset()
    mocks.updateTopic.mockReset()
    mocks.setModel.mockReset()
    mocks.setDefaultModel.mockReset()
    mocks.setFiles.mockReset()
    mocks.setMentionedModels.mockReset()
    mocks.setMentionedModels.mockImplementation((nextModels: Model[] | ((previous: Model[]) => Model[])) => {
      mocks.mentionedModels = typeof nextModels === 'function' ? nextModels(mocks.mentionedModels ?? []) : nextModels
    })
    mocks.setSelectedKnowledgeBases.mockReset()
    mocks.setIsExpanded.mockReset()
    mocks.updateAssistant.mockReset()
    mocks.toastError.mockReset()
    mocks.shortcutHandlers.clear()
    mocks.mentionedModels = undefined
    mocks.assistant = {
      id: 'assistant-1',
      name: 'Assistant 1',
      emoji: 'A',
      settings: { enableWebSearch: true },
      knowledgeBaseIds: []
    }
    mocks.model = model
    mocks.assistantLoading = false
    mocks.modelPending = false
    mocks.modelMissing = undefined
    mocks.topicPending = false
    mocks.draftItems = []
    mocks.canSteerDraft = false
    mocks.enqueueDraft.mockReset()
    mocks.enqueueDraft.mockResolvedValue(undefined)
    mocks.completeDraft.mockReset()
    mocks.completeDraft.mockResolvedValue(undefined)
    mocks.failDraft.mockReset()
    mocks.failDraft.mockResolvedValue(undefined)
    mocks.surfaceProps = undefined
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: { error: mocks.toastError }
    })
  })

  it('renders the tool menu before assistant and model selectors', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(mocks.surfaceProps?.topContent).toBeUndefined()
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

    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })
  })

  it('uses mentioned-model multi-select when requested by the composer toolbar', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multiple', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([model, modelB])
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('updates the assistant model from the home model selector in single-select mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])
  })

  it('syncs the mentioned-model selector when a model token remove event is handled', () => {
    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')

    fireEvent.click(screen.getByTestId('remove-token-model:provider::model-b'))

    expect(mocks.setMentionedModels).toHaveBeenLastCalledWith([model])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByTestId('remove-token-model:provider::model-a'))

    expect(mocks.setMentionedModels).toHaveBeenLastCalledWith([])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')
  })

  it('does not update the default model while a persisted assistant is loading', () => {
    mocks.assistant = undefined
    mocks.model = undefined

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setDefaultModel).not.toHaveBeenCalled()
    expect(mocks.setModel).not.toHaveBeenCalled()
  })

  it('shows model selection instead of a fallback model when the assistant has no configured model', () => {
    mocks.model = undefined

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByText('button.select_model')).toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('code.model_required')
  })

  it('shows assistant selection instead of the default assistant for unlinked home topics', () => {
    mocks.assistant = undefined

    render(<ChatHomeComposer topic={unlinkedTopic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_assistant')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Default Assistant')
    expect(screen.getByTestId('composer-below-controls')).not.toHaveTextContent('Model A | Provider')
    expect(screen.getByTestId('assistant-selector')).toHaveAttribute('data-value', '')
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBe('button.select_assistant')
  })

  it('blocks sends for missing-assistant topics until a new assistant is selected', async () => {
    mocks.assistant = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={missingAssistantTopic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })
    fireEvent.click(screen.getByText('select assistant 2'))

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('button.select_assistant')
    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-missing', { assistantId: 'assistant-2' })
    expect(mocks.setDefaultModel).not.toHaveBeenCalled()
  })

  it('shows a loading model state while the assistant model is resolving', () => {
    mocks.assistant = undefined
    mocks.model = undefined
    mocks.assistantLoading = true
    mocks.modelPending = true

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getAllByText('common.loading').length).toBeGreaterThan(0)
    expect(screen.queryByText('button.select_model')).not.toBeInTheDocument()
    expect(mocks.surfaceProps?.sendDisabled).toBe(true)
    expect(mocks.surfaceProps?.sendBlockedReason).toBeUndefined()
  })

  it('blocks send with a model-required toast when the assistant has no configured model', async () => {
    mocks.model = undefined
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('code.model_required')
  })

  it('queues send drafts while the topic is streaming', async () => {
    mocks.topicPending = true
    const onSend = vi.fn()

    render(<ChatComposer topic={topic} onSend={onSend} />)

    await mocks.surfaceProps?.onSendDraft({ text: 'hello', tokens: [] })

    expect(onSend).not.toHaveBeenCalled()
    expect(mocks.enqueueDraft).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }))
  })

  it('steers a queued draft into the active response from the queue panel', async () => {
    const draftItem: ComposerQueueItem = {
      id: 'draft-steer',
      scopeId: 'topic-1',
      status: 'queued',
      payload: {
        text: 'queued steering',
        userMessageParts: [{ type: 'text', text: 'queued steering' }]
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    mocks.draftItems = [draftItem]
    mocks.canSteerDraft = true
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<ChatComposer topic={topic} onSend={onSend} />)

    const queueContent = mocks.surfaceProps?.queueContent
    if (!isValidElement<{ onSteerDraft: (item: ComposerQueueItem) => Promise<void> }>(queueContent)) {
      throw new Error('queueContent was not rendered')
    }

    await queueContent.props.onSteerDraft(draftItem)

    expect(onSend).toHaveBeenCalledWith(
      'queued steering',
      expect.objectContaining({ userMessageParts: draftItem.payload.userMessageParts })
    )
    expect(mocks.completeDraft).toHaveBeenCalledWith('draft-steer')
    expect(mocks.failDraft).not.toHaveBeenCalled()
  })

  it('routes new topic shortcuts through the explicit parent action', () => {
    const onNewTopic = vi.fn()
    render(<ChatComposer topic={topic} onSend={vi.fn()} onNewTopic={onNewTopic} />)

    mocks.shortcutHandlers.get('topic.new')?.()

    expect(onNewTopic).toHaveBeenCalledWith(undefined)
    expect(mocks.createTopic).not.toHaveBeenCalled()
  })

  it('renders selectors below the surface in temporary home mode', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('composer-top-content')).toHaveTextContent('chat.home.welcome_title')
    expect(mocks.surfaceProps?.topContent).toBeDefined()
    expect(screen.getByTestId('composer-left-controls')).toHaveTextContent('tool menu')
    expect(screen.getByTestId('composer-left-controls')).not.toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Assistant 1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('routes temporary home assistant changes to the temporary handler', async () => {
    const onTemporaryAssistantChange = vi.fn()
    const view = render(
      <ChatHomeComposer topic={topic} onSend={vi.fn()} onTemporaryAssistantChange={onTemporaryAssistantChange} />
    )

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
    expect(mocks.setMentionedModels).not.toHaveBeenCalledWith([model])
    mocks.setMentionedModels.mockClear()

    fireEvent.click(screen.getByText('select assistant 2'))

    mocks.assistant = { ...mocks.assistant, id: 'assistant-2' }
    mocks.model = modelB
    mocks.mentionedModels = []
    view.rerender(
      <ChatHomeComposer
        topic={{ ...topic, assistantId: 'assistant-2' }}
        onSend={vi.fn()}
        onTemporaryAssistantChange={onTemporaryAssistantChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B | Provider')
    })
    expect(mocks.setMentionedModels).not.toHaveBeenCalledWith([modelB])
    expect(onTemporaryAssistantChange).toHaveBeenCalledWith('assistant-2')
    expect(mocks.updateTopic).not.toHaveBeenCalled()
  })

  it('uses the temporary home model selector as single-select until multi-select is enabled', async () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    const selector = screen.getByTestId('model-selector')
    expect(selector).toHaveAttribute('data-multiple', 'true')
    expect(selector).toHaveAttribute('data-default-multi-select', 'false')
    expect(selector).toHaveAttribute('data-multi-select-mode', 'false')
    expect(selector).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('select model 2'))

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    expect(mocks.setModel).toHaveBeenCalledWith(modelB, { enableWebSearch: false })

    mocks.model = undefined
    mocks.modelPending = true
    view.rerender(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model B')
    })
  })

  it('does not hydrate temporary home model selection from mentioned-model cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
  })

  it('does not hydrate the docked model selector from mentioned-model cache', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} useMentionedModelSelector />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
    expect(screen.getByText('Model A | Provider')).toBeInTheDocument()
  })

  it('keeps cached mentioned models for token-based model mentions', () => {
    vi.mocked(cacheService.getCasual).mockImplementation((key: string) =>
      key.startsWith('inputbar-mentioned-models-') ? [model, modelB] : ''
    )

    render(<ChatComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('remove-token-model:provider::model-a')).toBeInTheDocument()
    expect(screen.getByTestId('remove-token-model:provider::model-b')).toBeInTheDocument()
  })

  it('fills mentioned-model tokens only after enabling multi-select and selecting multiple models', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '2')
    expect(mocks.setMentionedModels).toHaveBeenCalledWith([model, modelB])
  })

  it('keeps the temporary home model selector empty after manual clear', () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')

    fireEvent.click(screen.getByText('clear model selection'))

    expect(mocks.setMentionedModels).toHaveBeenCalledWith([])

    mocks.mentionedModels = []
    view.rerender(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')
    expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('button.select_model')
  })

  it('reinitializes the temporary home selector when a new topic is created', async () => {
    const view = render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('clear model selection'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '0')

    view.rerender(<ChatHomeComposer topic={{ ...topic, id: 'topic-2' }} onSend={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-value-count', '1')
      expect(screen.getByTestId('composer-below-controls')).toHaveTextContent('Model A | Provider')
    })
  })

  it('summarizes multiple temporary home model selections in the trigger', () => {
    render(<ChatHomeComposer topic={topic} onSend={vi.fn()} />)

    fireEvent.click(screen.getByText('toggle model multi select'))
    fireEvent.click(screen.getByText('select models 1 and 2'))
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-multi-select-mode', 'true')

    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })
})
