import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import ComposerSurface, {
  type ComposerSurfaceActions,
  InputbarToolsProvider
} from '@renderer/components/chat/composer/ComposerSurface'
import { isGenerateImageModel, isGenerateImageModels, isVisionModel, isVisionModels } from '@renderer/config/models'
import { useCache } from '@renderer/data/hooks/useCache'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useTimer } from '@renderer/hooks/useTimer'
import { mapApiTopicToRendererTopic, useTopicMutations } from '@renderer/hooks/useTopic'
import { useTopicAwaitingApproval } from '@renderer/hooks/useTopicAwaitingApproval'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import {
  useInputbarToolsDispatch,
  useInputbarToolsInternalDispatch,
  useInputbarToolsState
} from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { resolveNewTopicAssistantId } from '@renderer/pages/home/Inputbar/Inputbar.helpers'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import { type AddNewTopicPayload, EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { FileMetadata, Topic } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { getSendMessageShortcutLabel } from '@renderer/utils/input'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toLegacyComposerPayload } from '../composerDraft'
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
    options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }
  ) => void | Promise<void>
}

type ProviderActionHandlers = ComposerSurfaceActions & {
  addNewTopic: (payload?: AddNewTopicPayload) => void
  clearTopic: () => void
  onNewContext: () => void
}

const emptyActions: ProviderActionHandlers = {
  resizeTextArea: () => undefined,
  addNewTopic: () => undefined,
  clearTopic: () => undefined,
  onNewContext: () => undefined,
  onTextChange: () => undefined,
  toggleExpanded: () => undefined
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
    <InputbarToolsProvider
      initialState={initialState}
      actions={{
        resizeTextArea: () => actionsRef.current.resizeTextArea(),
        addNewTopic: () => actionsRef.current.addNewTopic(),
        clearTopic: () => actionsRef.current.clearTopic(),
        onNewContext: () => actionsRef.current.onNewContext(),
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        toggleExpanded: (next) => actionsRef.current.toggleExpanded(next)
      }}>
      <ChatComposerInner setActiveTopic={setActiveTopic} topic={topic} actionsRef={actionsRef} onSend={onSend} />
    </InputbarToolsProvider>
  )
}

interface ChatComposerInnerProps extends ChatComposerProps {
  actionsRef: React.MutableRefObject<ProviderActionHandlers>
}

const ChatComposerInner = ({ setActiveTopic, topic, actionsRef, onSend }: ChatComposerInnerProps) => {
  const awaitingApproval = useTopicAwaitingApproval(topic.id)
  const scope = topic.type ?? TopicType.Chat
  const config = getInputbarConfig(scope)
  const { files, mentionedModels, selectedKnowledgeBases } = useInputbarToolsState()
  const { setFiles, setMentionedModels, setSelectedKnowledgeBases } = useInputbarToolsDispatch()
  const { setCouldAddImageFile } = useInputbarToolsInternalDispatch()
  const { assistant, model, updateAssistant } = useAssistant(topic.assistantId)
  const { createTopic } = useTopicMutations()
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

  const clearTopic = useCallback(async () => {
    if (loading) {
      onPause()
      await delay(1)
    }
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [loading, onPause, topic])

  const onNewContext = useCallback(() => {
    if (loading) {
      onPause()
      return
    }
    void EventEmitter.emit(EVENT_NAMES.NEW_CONTEXT)
  }, [loading, onPause])

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
    Object.assign(actionsRef.current, { addNewTopic, clearTopic, onNewContext })
  }, [actionsRef, addNewTopic, clearTopic, onNewContext])

  useShortcut(
    'topic.new',
    () => {
      void addNewTopic()
      void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    },
    { preventDefault: true, enableOnFormTags: true }
  )

  useShortcut('chat.clear', clearTopic, {
    preventDefault: true,
    enableOnFormTags: true
  })

  useEffect(() => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.ADD_NEW_TOPIC, addNewTopic)]
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [addNewTopic])

  useEffect(() => {
    const ids = assistant?.knowledgeBaseIds ?? []
    if (ids.length === 0) {
      setSelectedKnowledgeBases([])
      return
    }
    setSelectedKnowledgeBases(allKnowledgeBases.filter((kb): kb is KnowledgeBase => ids.includes(kb.id)))
  }, [assistant?.knowledgeBaseIds, allKnowledgeBases, setSelectedKnowledgeBases])

  const handleSendDraft = useCallback(
    async (draft: ComposerSerializedDraft) => {
      const legacyPayload = toLegacyComposerPayload(draft)
      const nextText = legacyPayload.text.trim()
      if (!nextText) return

      setIsSending(true)
      setText('')
      setFiles([])

      try {
        await onSend(nextText, {
          files: legacyPayload.files?.length ? (legacyPayload.files as FileMetadata[]) : undefined,
          mentionedModels: legacyPayload.mentionedModels?.length
            ? (legacyPayload.mentionedModels as Model[]).map((currentModel) => currentModel.id)
            : undefined
        })
      } catch (error) {
        logger.warn('send failed', { error })
      } finally {
        setIsSending(false)
      }
    },
    [onSend, setFiles, setText]
  )

  if (isMultiSelectMode) return null

  return (
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
      scope={scope}
      assistant={assistant}
      model={model}
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
    />
  )
}

export default ChatComposer
