import { Button } from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
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
import { useAssistant, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import { useDefaultModel } from '@renderer/hooks/useModel'
import { useProviderDisplayName } from '@renderer/hooks/useProvider'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { resolveNewTopicAssistantId } from '@renderer/pages/home/Inputbar/Inputbar.helpers'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import { type AddNewTopicPayload, EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
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

const getMentionedModelsCacheKey = (assistantId: string | undefined) =>
  `inputbar-mentioned-models-${assistantId ?? 'no-assistant'}`

const getValidatedCachedModels = (assistantId: string | undefined): Model[] => {
  const cached = cacheService.getCasual<Model[]>(getMentionedModelsCacheKey(assistantId))
  if (!Array.isArray(cached)) return []
  return cached.filter((model) => model?.id && model?.name)
}

interface ChatComposerProps {
  setActiveTopic: (topic: Topic) => void
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

interface ChatComposerToolbarControlsProps {
  inputAdapter?: QuickPanelInputAdapter
  assistantId: string | null
  assistantName: string
  assistantEmoji?: string
  model?: Model
  modelProviderName?: string
  selectModelLabel: string
  onAssistantChange: (assistantId: string | null) => void | Promise<void>
  onModelSelect: (model: Model | undefined) => void
}

const ChatComposerToolbarControls = ({
  inputAdapter,
  assistantId,
  assistantName,
  assistantEmoji,
  model,
  modelProviderName,
  selectModelLabel,
  onAssistantChange,
  onModelSelect
}: ChatComposerToolbarControlsProps) => {
  return (
    <div className={COMPOSER_TOOLBAR_CLASS}>
      <ComposerToolMenu inputAdapter={inputAdapter} />
      <AssistantSelector
        multi={false}
        value={assistantId}
        onChange={onAssistantChange}
        side="top"
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS}>
            <EmojiIcon emoji={assistantEmoji || getLeadingEmoji(assistantName)} size={20} />
            <span className="max-w-40 truncate">{assistantName}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <ModelSelector
        multiple={false}
        value={model}
        onSelect={onModelSelect}
        filter={CHAT_MODEL_FILTER}
        shortcut="chat.select_model"
        side="top"
        align="start"
        mountStrategy="lazy-keep"
        trigger={
          <Button variant="ghost" size="sm" className={COMPOSER_SELECTOR_BUTTON_CLASS}>
            <ModelAvatar model={model} size={20} />
            <span className="max-w-52 truncate">
              {model ? model.name : selectModelLabel}
              {modelProviderName ? ` | ${modelProviderName}` : ''}
            </span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
    </div>
  )
}

const ChatComposer = ({ setActiveTopic, topic, onSend }: ChatComposerProps) => {
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })
  const [initialMentionedModels] = useState(() => getValidatedCachedModels(topic.assistantId))

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
      <ChatComposerInner setActiveTopic={setActiveTopic} topic={topic} actionsRef={actionsRef} onSend={onSend} />
    </ComposerToolRuntimeProvider>
  )
}

interface ChatComposerInnerProps extends ChatComposerProps {
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
}

const ChatComposerInner = ({ setActiveTopic, topic, actionsRef, onSend }: ChatComposerInnerProps) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)
  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases, isExpanded } = useComposerToolState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases, triggers, setIsExpanded } = useComposerToolDispatch()
  const { setCouldAddImageFile, setExtensions } = useComposerToolInternalDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const { assistant, model, setModel, updateAssistant } = useAssistant(topic.assistantId)
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { setDefaultModel } = useDefaultModel()
  const { createTopic, updateTopic } = useTopicMutations()
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
  const { setTimeoutTimer } = useTimer()
  const [isSending, setIsSending] = useState(false)
  const [text, setTextState] = useState(() => cacheService.getCasual<string>(INPUTBAR_DRAFT_CACHE_KEY) ?? '')

  useEffect(() => {
    if (isPending) setIsSending(false)
  }, [isPending])

  useEffect(() => {
    setIsSending(false)
  }, [topic.id])

  const loading = isPending || isSending || awaitingApproval
  const runtimeAssistant = assistant ?? defaultAssistant
  const selectedAssistantId = topic.assistantId ?? defaultAssistant.id
  const assistantName = runtimeAssistant.name || t('chat.default.name')
  const providerName = useProviderDisplayName(model?.providerId)
  const isVisionAssistant = useMemo(() => (model ? isVisionModel(model) : false), [model])
  const isGenerateImageAssistant = useMemo(() => (model ? isGenerateImageModel(model) : false), [model])

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
      await updateTopic(topic.id, { assistantId: nextId })
    },
    [selectedAssistantId, topic.id, updateTopic]
  )

  const handleModelSelect = useCallback(
    (nextModel: Model | undefined) => {
      if (!nextModel) return
      if (!assistant) {
        void setDefaultModel(nextModel)
        return
      }

      const enabledWebSearch = isWebSearchModel(nextModel)
      setModel(nextModel, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
    },
    [assistant, setDefaultModel, setModel]
  )

  const addNewTopic = useCallback(
    async (payload?: AddNewTopicPayload) => {
      const assistantId = resolveNewTopicAssistantId(topic.assistantId, payload)
      const persisted = await createTopic({ assistantId, name: t('chat.default.topic.name') })
      if (!persisted) return
      setActiveTopic(mapApiTopicToRendererTopic(persisted))
      setTimeoutTimer('addNewTopic', () => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
    },
    [createTopic, topic.assistantId, t, setActiveTopic, setTimeoutTimer]
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
      void addNewTopic()
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

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
    [files, mentionedModels, onSend, selectedKnowledgeBases, setFiles, setText]
  )

  if (isMultiSelectMode) return null

  return (
    <>
      {runtimeAssistant && model && (
        <ComposerToolRuntimeHost scope={scope} assistant={runtimeAssistant} model={model} />
      )}
      <ComposerSurface
        text={text}
        onTextChange={setText}
        tokens={tokens}
        managedTokenKinds={CHAT_MANAGED_TOKEN_KINDS}
        onTokensChange={handleTokensChange}
        placeholder={searching ? t('chat.input.translating') : placeholderText}
        sendDisabled={text.trim().length === 0 || loading || searching}
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
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        renderLeftControls={(inputAdapter) => (
          <ChatComposerToolbarControls
            inputAdapter={inputAdapter}
            assistantId={selectedAssistantId}
            assistantName={assistantName}
            assistantEmoji={runtimeAssistant.emoji}
            model={model}
            modelProviderName={providerName}
            selectModelLabel={t('button.select_model')}
            onAssistantChange={handleAssistantChange}
            onModelSelect={handleModelSelect}
          />
        )}
      />
    </>
  )
}

export default ChatComposer
