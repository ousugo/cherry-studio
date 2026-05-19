import { Button } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import AnimatedRevealText from '@renderer/components/AnimatedRevealText'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/chat/composer/ComposerSurface'
import {
  ComposerToolMenu,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolInternalDispatch,
  useComposerToolLauncherController,
  useComposerToolState
} from '@renderer/components/chat/composer/ComposerToolRuntime'
import EmojiIcon from '@renderer/components/EmojiIcon'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'
import { AssistantSelector, ModelSelector } from '@renderer/components/Selector'
import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import type { AddNewTopicPayload } from '@renderer/pages/home/types'
import type { FileMetadata, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel, isWebSearchModel } from '@shared/utils/model'
import { ChevronDown } from 'lucide-react'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts } from '../composerDraft'
import type { ComposerDraftToken, ComposerSerializedDraft, ComposerSerializedToken } from '../tokens'
import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken,
  modelToComposerToken
} from './chatComposerTokens'

const INPUTBAR_DRAFT_CACHE_KEY = 'inputbar-draft'
const DRAFT_CACHE_TTL = 24 * 60 * 60 * 1000
const logger = loggerService.withContext('ChatComposer')
const CHAT_MANAGED_TOKEN_KINDS = ['file', 'model', 'knowledge'] as const satisfies readonly ComposerDraftToken['kind'][]
const CHAT_MODEL_FILTER = (model: Model) => !isNonChatModel(model)
const COMPOSER_TOOLBAR_CLASS =
  'flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
const COMPOSER_SELECTOR_BUTTON_CLASS = 'h-7 shrink-0 gap-1.5 rounded-full px-2 text-xs'
const COMPOSER_BELOW_SELECTOR_BUTTON_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 text-xs font-medium text-muted-foreground/75 shadow-none hover:bg-transparent hover:text-muted-foreground/75 disabled:bg-transparent disabled:text-muted-foreground/50 [&_svg]:text-muted-foreground/60 hover:[&_svg]:text-muted-foreground/60'

const getMentionedModelsCacheKey = (assistantId: string | undefined) =>
  `inputbar-mentioned-models-${assistantId ?? 'no-assistant'}`

const getValidatedCachedModels = (assistantId: string | undefined): Model[] => {
  const cached = cacheService.getCasual<Model[]>(getMentionedModelsCacheKey(assistantId))
  if (!Array.isArray(cached)) return []
  const cachedModels = cached.filter((model) => model?.id && model?.name)
  return cachedModels.length > 1 ? cachedModels : []
}

interface ChatComposerProps {
  topic: Topic
  onSend: (
    text: string,
    options?: {
      files?: FileMetadata[]
      mentionedModels?: UniqueModelId[]
      knowledgeBaseIds?: KnowledgeBase['id'][]
      userMessageParts?: CherryMessagePart[]
    }
  ) => void | Promise<void>
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: (payload?: AddNewTopicPayload) => void
}

const emptyActions: ProviderActionHandlers = {
  resizeTextArea: () => undefined,
  addNewTopic: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined
}

interface ChatComposerContextControlsProps {
  topicId: string
  assistantId: string | null
  assistantName: string
  assistantEmoji?: string
  model?: Model
  modelProviderName?: string
  modelPending?: boolean
  mentionedModels: Model[]
  selectModelLabel: string
  useMentionedModelSelector?: boolean
  side: 'top' | 'bottom'
  onAssistantChange: (assistantId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
  onMentionedModelsSelect: (models: Model[]) => void
}

const ChatComposerContextControls = ({
  topicId,
  assistantId,
  assistantName,
  assistantEmoji,
  model,
  modelProviderName,
  modelPending,
  mentionedModels,
  selectModelLabel,
  useMentionedModelSelector,
  side,
  onAssistantChange,
  onModelSelect,
  onMentionedModelsSelect
}: ChatComposerContextControlsProps) => {
  const { t } = useTranslation()
  const [mentionedModelMultiSelectMode, setMentionedModelMultiSelectMode] = useState(false)
  const [mentionedModelSelectorValue, setMentionedModelSelectorValue] = useState<Model[]>([])
  const mentionedModelSelectorInitKeyRef = useRef<string | null>(null)
  const assistantIcon = assistantEmoji || getLeadingEmoji(assistantName)
  const triggerClassName = side === 'bottom' ? COMPOSER_BELOW_SELECTOR_BUTTON_CLASS : COMPOSER_SELECTOR_BUTTON_CLASS
  const selectedMentionedModels = useMentionedModelSelector ? mentionedModelSelectorValue : mentionedModels
  const selectedMentionedModel = selectedMentionedModels[0]
  const displayModel = useMentionedModelSelector ? selectedMentionedModel : model
  const assistantModelLabel = model
    ? `${model.name}${modelProviderName ? ` | ${modelProviderName}` : ''}`
    : selectModelLabel
  const selectedMentionedModelLabel = selectedMentionedModel
    ? `${selectedMentionedModel.name}${
        selectedMentionedModel.id === model?.id && modelProviderName ? ` | ${modelProviderName}` : ''
      }`
    : selectModelLabel
  const mentionedModelLabel =
    selectedMentionedModels.length > 1
      ? t('common.selectedItems', { count: selectedMentionedModels.length })
      : selectedMentionedModelLabel
  const modelLabel = useMentionedModelSelector ? mentionedModelLabel : assistantModelLabel

  useEffect(() => {
    if (!useMentionedModelSelector) {
      mentionedModelSelectorInitKeyRef.current = null
      return
    }

    const initializationKey = `${topicId}:${assistantId ?? 'no-assistant'}:${model?.id ?? 'no-model'}`
    if (mentionedModelSelectorInitKeyRef.current === initializationKey) return

    const isInitialSelection = mentionedModelSelectorInitKeyRef.current === null
    mentionedModelSelectorInitKeyRef.current = initializationKey
    setMentionedModelSelectorValue(
      isInitialSelection && mentionedModels.length > 1 ? mentionedModels : model ? [model] : []
    )
    setMentionedModelMultiSelectMode(false)

    if (!isInitialSelection && mentionedModels.length > 0) {
      onMentionedModelsSelect([])
    }
  }, [assistantId, mentionedModels, model, onMentionedModelsSelect, topicId, useMentionedModelSelector])

  const handleMentionedModelSelect = useCallback(
    (nextModels: Model[]) => {
      setMentionedModelSelectorValue(nextModels)
      onMentionedModelsSelect(mentionedModelMultiSelectMode && nextModels.length > 1 ? nextModels : [])
    },
    [mentionedModelMultiSelectMode, onMentionedModelsSelect]
  )

  const handleMentionedModelMultiSelectModeChange = useCallback(
    (nextEnabled: boolean) => {
      setMentionedModelMultiSelectMode(nextEnabled)

      if (nextEnabled) {
        return
      }

      setMentionedModelSelectorValue((currentModels) => currentModels.slice(0, 1))
      onMentionedModelsSelect([])
    },
    [onMentionedModelsSelect]
  )

  return (
    <>
      <AssistantSelector
        multi={false}
        value={assistantId}
        onChange={onAssistantChange}
        side={side}
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={triggerClassName}>
            {assistantIcon ? <EmojiIcon emoji={assistantIcon} size={20} /> : null}
            <span className="max-w-40 truncate">{assistantName}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      {useMentionedModelSelector ? (
        <ModelSelector
          multiple
          value={mentionedModelSelectorValue}
          onSelect={handleMentionedModelSelect}
          multiSelectMode={mentionedModelMultiSelectMode}
          onMultiSelectModeChange={handleMentionedModelMultiSelectModeChange}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.select_model"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={triggerClassName} disabled={modelPending}>
              <ModelAvatar model={displayModel} size={20} />
              <span className="max-w-52 truncate">{modelLabel}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
      ) : (
        <ModelSelector
          multiple={false}
          value={model}
          onSelect={onModelSelect}
          filter={CHAT_MODEL_FILTER}
          shortcut="chat.select_model"
          side={side}
          align="start"
          mountStrategy="lazy-keep"
          trigger={
            <Button variant="ghost" size="sm" className={triggerClassName} disabled={modelPending}>
              <ModelAvatar model={model} size={20} />
              <span className="max-w-52 truncate">{modelLabel}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
      )}
    </>
  )
}

interface ChatComposerToolbarControlsProps extends Omit<ChatComposerContextControlsProps, 'side'> {
  inputAdapter?: QuickPanelInputAdapter
}

const ChatComposerToolMenuControls = ({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) => {
  return <ComposerToolMenu inputAdapter={inputAdapter} />
}

const ChatComposerToolbarControls = ({ inputAdapter, ...contextProps }: ChatComposerToolbarControlsProps) => {
  return (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ChatComposerToolMenuControls inputAdapter={inputAdapter} />
      <ChatComposerContextControls {...contextProps} side="top" />
    </div>
  )
}

type ChatComposerControlProps = Omit<ChatComposerToolbarControlsProps, 'inputAdapter'>

const ChatComposerBelowControls = (contextProps: ChatComposerControlProps) => {
  return (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ChatComposerContextControls {...contextProps} side="bottom" useMentionedModelSelector />
    </div>
  )
}

type ComposerSurfaceProps = React.ComponentProps<typeof ComposerSurface>
type ChatComposerControlSlots = Pick<ComposerSurfaceProps, 'renderLeftControls' | 'renderBelowControls'>
type ChatComposerControlsRenderer = (props: ChatComposerControlProps) => ChatComposerControlSlots

const renderChatToolbarControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => <ChatComposerToolbarControls inputAdapter={inputAdapter} {...props} />
})

const renderChatHomeControls: ChatComposerControlsRenderer = (props) => ({
  renderLeftControls: (inputAdapter) => (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ChatComposerToolMenuControls inputAdapter={inputAdapter} />
    </div>
  ),
  renderBelowControls: () => <ChatComposerBelowControls {...props} />
})

type ChatComposerRootProps = ChatComposerProps & {
  renderControls: ChatComposerControlsRenderer
  topContent?: React.ReactNode
}

const ChatComposerRoot = ({
  topic,
  onSend,
  onTemporaryAssistantChange,
  onNewTopic,
  topContent,
  renderControls
}: ChatComposerRootProps) => {
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const initialMentionedModels = useMemo(() => {
    return getValidatedCachedModels(topic.assistantId)
  }, [topic.assistantId])

  const initialState = useMemo(
    () => ({
      files: [] as FileMetadata[],
      mentionedModels: initialMentionedModels,
      selectedKnowledgeBases: [] as KnowledgeBase[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    [initialMentionedModels]
  )

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next)
      }}>
      <ChatComposerInner
        topic={topic}
        actionsRef={actionsRef}
        onSend={onSend}
        onTemporaryAssistantChange={onTemporaryAssistantChange}
        onNewTopic={onNewTopic}
        topContent={topContent}
        renderControls={renderControls}
      />
    </ComposerToolRuntimeProvider>
  )
}

interface ChatComposerInnerProps extends Omit<ChatComposerProps, 'setActiveTopic'> {
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
  topContent?: React.ReactNode
  renderControls: ChatComposerControlsRenderer
}

const ChatComposerInner = ({
  topic,
  actionsRef,
  onSend,
  onTemporaryAssistantChange,
  onNewTopic,
  topContent,
  renderControls
}: ChatComposerInnerProps) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)
  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useComposerToolState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, triggers, setIsExpanded } = useComposerToolDispatch()
  const { setCouldAddImageFile, setExtensions } = useComposerToolInternalDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const {
    assistant,
    isLoading: isAssistantLoading,
    model,
    isModelPending,
    isModelMissing,
    setModel,
    updateAssistant
  } = useAssistant(topic.assistantId)
  const { updateTopic } = useTopicMutations()
  const { knowledgeBases: allKnowledgeBases } = useKnowledgeBases()
  const [sendMessageShortcut] = usePreference('chat.input.send_message_shortcut')
  const [enableQuickPanelTriggers] = usePreference('chat.input.quick_panel.triggers_enabled')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const [searching, setSearching] = useCache('chat.web_search.searching')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const { t } = useTranslation()
  const chatWrite = useChatWrite()
  const { isPending } = useTopicStreamStatus(topic.id)
  const [isSending, setIsSending] = useState(false)
  const [text, setTextState] = useState(() => cacheService.getCasual<string>(INPUTBAR_DRAFT_CACHE_KEY) ?? '')
  const selectAssistantMessage = t('button.select_assistant')
  const runtimeModel = assistant ? model : undefined
  const runtimeModelPending = isAssistantLoading || (!!assistant && isModelPending)
  const missingAssistantMessage = !isAssistantLoading && !assistant ? selectAssistantMessage : undefined
  const missingModelMessage = assistant && isModelMissing ? t('code.model_required') : undefined

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [topic.id])

  const loading = isPending || isSending || awaitingApproval
  const selectedAssistantId = assistant?.id ?? null
  const assistantName = assistant?.name ?? (isAssistantLoading ? t('common.loading') : selectAssistantMessage)
  const providerName = useProviderDisplayName(runtimeModel?.providerId)

  const isVisionAssistant = useMemo(() => (runtimeModel ? isVisionModel(runtimeModel) : false), [runtimeModel])
  const isGenerateImageAssistant = useMemo(
    () => (runtimeModel ? isGenerateImageModel(runtimeModel) : false),
    [runtimeModel]
  )

  const isVisionSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isVisionModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isVisionAssistant),
    [mentionedModels, isVisionAssistant]
  )

  const isGenerateImageSupported = useMemo(
    () =>
      (mentionedModels.length > 0 && isGenerateImageModels(mentionedModels)) ||
      (mentionedModels.length === 0 && isGenerateImageAssistant),
    [mentionedModels, isGenerateImageAssistant]
  )

  const canAddImageFile = useMemo(
    () => isVisionSupported || isGenerateImageSupported,
    [isGenerateImageSupported, isVisionSupported]
  )

  const canAddTextFile = useMemo(
    () => isVisionSupported || (!isVisionSupported && !isGenerateImageSupported),
    [isGenerateImageSupported, isVisionSupported]
  )

  const supportedExts = useMemo(() => {
    if (canAddImageFile && canAddTextFile) return [...imageExts, ...documentExts, ...textExts]
    if (canAddImageFile) return [...imageExts]
    if (canAddTextFile) return [...documentExts, ...textExts]
    return []
  }, [canAddImageFile, canAddTextFile])

  useEffect(() => {
    setCouldAddImageFile(canAddImageFile)
  }, [canAddImageFile, setCouldAddImageFile])

  useEffect(() => {
    setExtensions(supportedExts)
  }, [setExtensions, supportedExts])

  const setText = useCallback((nextText: string) => {
    setTextState(nextText)
    cacheService.setCasual(INPUTBAR_DRAFT_CACHE_KEY, nextText, DRAFT_CACHE_TTL)
  }, [])

  const placeholderText = enableQuickPanelTriggers
    ? t('chat.input.placeholder', { key: getSendMessageShortcutLabel(sendMessageShortcut) })
    : t('chat.input.placeholder_without_triggers', {
        key: getSendMessageShortcutLabel(sendMessageShortcut),
        defaultValue: t('chat.input.placeholder', {
          key: getSendMessageShortcutLabel(sendMessageShortcut)
        })
      })

  const tokens = useMemo(
    () => [
      ...files.map(fileToComposerToken),
      ...mentionedModels.map(modelToComposerToken),
      ...selectedKnowledgeBases.map(knowledgeBaseToComposerToken)
    ],
    [files, mentionedModels, selectedKnowledgeBases]
  )

  const handleTokensChange = useCallback(
    (draftTokens: readonly ComposerSerializedToken[]) => {
      const tokenIds = getComposerTokenIds(draftTokens)
      setFiles((prev) => prev.filter((file) => tokenIds.has(chatComposerTokenId.file(file))))
      setMentionedModels((prev) => prev.filter((currentModel) => tokenIds.has(chatComposerTokenId.model(currentModel))))
      const nextSelectedKnowledgeBases = selectedKnowledgeBases.filter((base) =>
        tokenIds.has(chatComposerTokenId.knowledge(base))
      )
      if (nextSelectedKnowledgeBases.length !== selectedKnowledgeBases.length) {
        const nextIds = (assistant?.knowledgeBaseIds ?? []).filter((id) => tokenIds.has(`knowledge:${id}`))
        void updateAssistant({ knowledgeBaseIds: nextIds })
      }
      setSelectedKnowledgeBases(nextSelectedKnowledgeBases)
    },
    [
      assistant?.knowledgeBaseIds,
      selectedKnowledgeBases,
      setFiles,
      setMentionedModels,
      setSelectedKnowledgeBases,
      updateAssistant
    ]
  )

  useEffect(() => {
    setFiles((prev) => {
      const counts = new Map<string, number>()
      for (const file of prev) {
        const id = chatComposerTokenId.file(file)
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }

      const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id))
      if (duplicateIds.size === 0) return prev

      return prev.filter((file) => !duplicateIds.has(chatComposerTokenId.file(file)))
    })
  }, [files, setFiles])

  const onUnmount = useEffectEvent((id: string | undefined) => {
    cacheService.setCasual(getMentionedModelsCacheKey(id), mentionedModels, DRAFT_CACHE_TTL)
  })

  useEffect(() => {
    return () => onUnmount(topic.assistantId)
  }, [onUnmount, topic.assistantId])

  const onPause = useCallback(() => {
    chatWrite?.pause()
  }, [chatWrite])

  const handleAssistantChange = useCallback(
    async (nextId: string | null) => {
      if (!nextId || nextId === selectedAssistantId) return
      if (onTemporaryAssistantChange) {
        await onTemporaryAssistantChange(nextId)
        return
      }
      await updateTopic(topic.id, { assistantId: nextId })
    },
    [onTemporaryAssistantChange, selectedAssistantId, topic.id, updateTopic]
  )

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!nextModel) return
      if (!assistant) return

      const enabledWebSearch = isWebSearchModel(nextModel)
      setModel(nextModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    },
    [assistant, setModel]
  )
  const handleMentionedModelsSelect = useCallback(
    (nextModels: Model[]) => {
      setMentionedModels(nextModels)
    },
    [setMentionedModels]
  )

  const addNewTopic = useCallback(
    (payload?: AddNewTopicPayload) => {
      void onNewTopic?.(payload)
    },
    [onNewTopic]
  )

  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )

  useEffect(() => {
    Object.assign(actionsRef.current, { addNewTopic })
  }, [actionsRef, addNewTopic])

  useShortcut(
    'topic.new',
    () => {
      addNewTopic()
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useEffect(() => {
    if (!assistant?.id) return
    const ids = assistant?.knowledgeBaseIds ?? []
    if (ids.length === 0) {
      setSelectedKnowledgeBases([])
      return
    }
    setSelectedKnowledgeBases(allKnowledgeBases.filter((kb): kb is KnowledgeBase => ids.includes(kb.id)))
  }, [assistant?.id, assistant?.knowledgeBaseIds, allKnowledgeBases, setSelectedKnowledgeBases])

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      if (!assistant) {
        window.toast?.error(selectAssistantMessage)
        return
      }

      if (!runtimeModel) {
        window.toast?.error(t('code.model_required'))
        return
      }

      const nextText = draft.text.trim()
      if (!nextText) return
      const tokenIds = getComposerTokenIds(draft.tokens)
      const payloadFiles = files.filter((file) => tokenIds.has(chatComposerTokenId.file(file)))
      const payloadModels = mentionedModels.filter((currentModel) =>
        tokenIds.has(chatComposerTokenId.model(currentModel))
      )
      const payloadKnowledgeBases = selectedKnowledgeBases.filter((base) =>
        tokenIds.has(chatComposerTokenId.knowledge(base))
      )
      const userMessageParts = createComposerUserMessageParts(draft, { files: payloadFiles })

      const knowledgeBaseIds = payloadKnowledgeBases.map((base) => base.id)

      setIsSending(true)
      setText('')
      setFiles([])

      try {
        await onSend(nextText, {
          files: payloadFiles.length ? payloadFiles : undefined,
          mentionedModels: payloadModels.length ? payloadModels.map((currentModel) => currentModel.id) : undefined,
          knowledgeBaseIds: knowledgeBaseIds?.length ? knowledgeBaseIds : undefined,
          userMessageParts
        })
      } catch (error) {
        logger.warn('send failed', { error })
      } finally {
        setIsSending(false)
      }
    },
    [
      assistant,
      files,
      mentionedModels,
      onSend,
      runtimeModel,
      selectedKnowledgeBases,
      selectAssistantMessage,
      setFiles,
      setText,
      t
    ]
  )

  if (isMultiSelectMode) return null

  const controlSlots = renderControls({
    topicId: topic.id,
    assistantId: selectedAssistantId,
    assistantName,
    assistantEmoji: assistant?.emoji,
    model: runtimeModel,
    modelProviderName: providerName,
    modelPending: runtimeModelPending,
    mentionedModels,
    selectModelLabel: runtimeModelPending ? t('common.loading') : t('button.select_model'),
    onAssistantChange: handleAssistantChange,
    onModelSelect: handleModelSelect,
    onMentionedModelsSelect: handleMentionedModelsSelect
  })

  return (
    <>
      {assistant && runtimeModel && (
        <ComposerToolRuntimeHost scope={scope} assistant={assistant} model={runtimeModel} />
      )}
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        managedTokenKinds={CHAT_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        placeholder={searching ? t('chat.input.translating') : placeholderText}
        sendDisabled={
          text.trim().length === 0 ||
          loading ||
          searching ||
          runtimeModelPending ||
          !!missingAssistantMessage ||
          !!missingModelMessage
        }
        sendBlockedReason={missingAssistantMessage ?? missingModelMessage}
        isLoading={loading}
        onSendDraft={handleSendDraft}
        onPause={onPause}
        supportedExts={supportedExts}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableQuickPanelTriggers={enableQuickPanelTriggers}
        enableMentionModelTrigger
        enableDragDrop={config.enableDragDrop ?? true}
        enableSpellCheck={enableSpellCheck}
        editable={!searching}
        fontSize={fontSize}
        narrowMode={narrowMode}
        onFocus={() => setSearching(false)}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers('root-panel')}
        emitToolTrigger={triggers.emit}
        topContent={topContent}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        {...controlSlots}
      />
    </>
  )
}

const ChatComposer = (props: ChatComposerProps) => {
  return <ChatComposerRoot {...props} renderControls={renderChatToolbarControls} />
}

export const ChatHomeComposer = (props: ChatComposerProps) => {
  const { t } = useTranslation()
  return (
    <ChatComposerRoot
      {...props}
      topContent={<AnimatedRevealText text={t('chat.home.welcome_title')} />}
      renderControls={renderChatHomeControls}
    />
  )
}

export default ChatComposer
