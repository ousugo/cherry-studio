import { loggerService } from '@logger'
import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import { type TranslationOverlayEntry, type TranslationOverlaySetter } from '@renderer/components/chat/messages/blocks'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import type { TemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { useStablePartsByMessageId } from './hooks/useStablePartsByMessageId'
import { useTopicMessagesCache, type UseTopicMessagesCacheParams } from './hooks/useTopicMessagesCache'

const logger = loggerService.withContext('useChatRuntimeState')

export interface ChatTurnInput {
  text: string
  options?: {
    files?: FileMetadata[]
    mentionedModels?: UniqueModelId[]
    knowledgeBaseIds?: string[]
    userMessageParts?: CherryMessagePart[]
  }
}

interface UseChatRuntimeStateParams {
  topic: Topic
  isHistoryLoading: boolean
  isFreshTemporaryTopic: boolean
  onPersistTemporaryTopic?: (initialName?: string) => Promise<TemporaryConversation | null>
  onTemporaryTopicPersisted: () => void
  initialMessages: CherryUIMessage[]
  uiMessages: CherryUIMessage[]
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  messagesCacheMutate: UseTopicMessagesCacheParams['mutate']
}

export function useChatRuntimeState({
  topic,
  isHistoryLoading,
  isFreshTemporaryTopic,
  onPersistTemporaryTopic,
  onTemporaryTopicPersisted,
  initialMessages,
  uiMessages,
  refresh,
  activeNodeId,
  messagesCacheMutate
}: UseChatRuntimeStateParams) {
  const { regenerate, stop, status, setMessages, activeExecutions } = useChatWithHistory(
    topic.id,
    initialMessages,
    refresh
  )
  const messages = uiMessages

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    setMessages(uiMessages)
  }, [uiMessages, status, setMessages])

  const [translationOverlay, setTranslationOverlayMap] = useState<Record<string, TranslationOverlayEntry>>({})
  const setTranslationOverlay = useCallback<TranslationOverlaySetter>((messageId, entry) => {
    setTranslationOverlayMap((prev) => {
      if (entry == null) {
        if (!(messageId in prev)) return prev
        const next = { ...prev }
        delete next[messageId]
        return next
      }
      const existing = prev[messageId]
      if (
        existing &&
        existing.content === entry.content &&
        existing.targetLanguage === entry.targetLanguage &&
        existing.sourceLanguage === entry.sourceLanguage
      ) {
        return prev
      }
      return { ...prev, [messageId]: entry }
    })
  }, [])

  const finishRef = useRef<(executionId: string, event: ExecutionFinishEvent) => void>(undefined)
  const { overlay, disposeOverlay } = useExecutionOverlay(topic.id, activeExecutions, messages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const partsByMessageId = useStablePartsByMessageId(messages, overlay, translationOverlay)

  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo<ComposerContextValue>(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: cache.seedReservedMessages,
      refresh,
      rollback: isFreshTemporaryTopic ? cache.clearBranchCache : cache.rollbackBranch
    }),
    [cache.clearBranchCache, cache.rollbackBranch, cache.seedReservedMessages, isFreshTemporaryTopic, refresh]
  )
  const turnController = useConversationTurnController<
    ChatTurnInput,
    { topicId: string; parentAnchorId: string | null }
  >({
    scopeKey: topic.id,
    historyAdapter,
    ensureConversation: async ({ text }) => {
      if (isHistoryLoading) return null
      if (isFreshTemporaryTopic && onPersistTemporaryTopic) {
        const persisted = await onPersistTemporaryTopic(text)
        if (persisted?.type !== 'assistant') {
          throw new Error('Temporary topic handoff failed before stream open')
        }
        onTemporaryTopicPersisted()
        return { topicId: persisted.topicId, parentAnchorId: activeNodeId ?? null }
      }
      return { topicId: topic.id, parentAnchorId: activeNodeId ?? null }
    },
    buildStreamRequest: ({ text, options }, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      parentAnchorId: conversation.parentAnchorId ?? undefined,
      userMessageParts: options?.userMessageParts ?? [{ type: 'text', text }],
      mentionedModelIds: options?.mentionedModels
    })
  })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message, isError }: ExecutionFinishEvent) => {
      if (isError || !message.parts?.length) {
        void cache.rollbackBranch().then(() => disposeOverlay(message.id))
        return
      }
      void refresh().finally(() => disposeOverlay(message.id))
    },
    [cache, disposeOverlay, refresh]
  )
  finishRef.current = handleExecutionFinish

  const shouldRenderHomeComposer =
    !isHistoryLoading &&
    isFreshTemporaryTopic &&
    turnController.layout === 'draft' &&
    uiMessages.length === 0 &&
    activeExecutions.length === 0

  const { actions: chatWriteActions } = useChatWriteActions({
    topic,
    uiMessages: messages,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const sendMessage = useCallback(
    async (text: string, options?: ChatTurnInput['options']) => {
      try {
        await turnController.send({ text, options })
      } catch (err) {
        logger.warn('failed to open conversation turn', err as Error)
        throw err
      }
    },
    [turnController]
  )

  return {
    messages,
    partsByMessageId,
    respondToolApproval,
    composerContext,
    shouldRenderHomeComposer,
    chatWriteActions,
    sendMessage,
    translationOverlay,
    setTranslationOverlay
  }
}
