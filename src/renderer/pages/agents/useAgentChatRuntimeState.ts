import { loggerService } from '@logger'
import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useTopicOverlayHandoffOnTerminal, useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { GetAgentResponse } from '@renderer/types'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useAgentChatRuntimeState')

export type AgentSendOptions = { body?: Record<string, unknown> }

export interface AgentTurnInput {
  text: string
  options?: AgentSendOptions
}

export function getAgentTurnParts(input: AgentTurnInput): CherryMessagePart[] {
  const parts = input.options?.body?.userMessageParts as CherryMessagePart[] | undefined
  return parts ?? (input.text ? [{ type: 'text', text: input.text }] : [])
}

// FIXME: perf problem maybe
function mergeLiveAgentMessages(baseMessages: CherryUIMessage[], liveMessages: CherryUIMessage[]): CherryUIMessage[] {
  const order: string[] = []
  const byId = new Map<string, CherryUIMessage>()

  for (const messages of [baseMessages, liveMessages]) {
    for (const message of messages) {
      const existing = byId.get(message.id)
      if (!existing) {
        order.push(message.id)
        byId.set(message.id, message)
        continue
      }

      const metadata = existing.metadata || message.metadata ? { ...existing.metadata, ...message.metadata } : undefined
      byId.set(message.id, {
        ...existing,
        ...message,
        ...(metadata && { metadata })
      })
    }
  }

  return order.flatMap((id) => {
    const message = byId.get(id)
    return message ? [message] : []
  })
}

export interface AgentChatRuntimeState {
  sessionId: string
  uiMessages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  fallbackSnapshot?: ModelSnapshot
  isPending: boolean
  stop: () => Promise<void>
  sendMessage: (message?: { text: string }, options?: AgentSendOptions) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  respondToolApproval: (input: MessageToolApprovalInput) => Promise<void>
  composerContext: ComposerContextValue
}

interface UseAgentChatRuntimeStateParams {
  session: AgentSessionEntity
  activeAgent: GetAgentResponse | undefined
  sessionMessagesEnabled: boolean
  sessionHistoryFetchOnMount?: boolean
  reservedMessages: CherryUIMessage[]
}

export function useAgentChatRuntimeState({
  session,
  activeAgent,
  sessionMessagesEnabled,
  sessionHistoryFetchOnMount,
  reservedMessages
}: UseAgentChatRuntimeStateParams): AgentChatRuntimeState {
  const sessionId = session.id
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    seedReservedMessages,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(sessionId, {
    enabled: sessionMessagesEnabled,
    fetchOnMount: sessionHistoryFetchOnMount
  })

  useLayoutEffect(() => {
    if (!sessionMessagesEnabled || reservedMessages.length === 0) return
    void seedReservedMessages(reservedMessages)
  }, [reservedMessages, seedReservedMessages, sessionMessagesEnabled])

  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)
  const historyAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages,
      refresh,
      rollback: refresh
    }),
    [refresh, seedReservedMessages]
  )
  const turnController = useConversationTurnController<AgentTurnInput, { topicId: string }>({
    scopeKey: sessionTopicId,
    historyAdapter,
    ensureConversation: () => ({ topicId: sessionTopicId }),
    buildStreamRequest: (input, conversation) => ({
      trigger: 'submit-message',
      topicId: conversation.topicId,
      userMessageParts: getAgentTurnParts(input)
    })
  })
  const sendMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await turnController.send({ text: message?.text ?? '', options })
    },
    [turnController]
  )
  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteSessionMessage(messageId)
      chat.setMessages((current) => current.filter((message) => message.id !== messageId))
    },
    [chat, deleteSessionMessage]
  )

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!isUniqueModelId(modelString)) return undefined
    const { providerId, modelId } = parseUniqueModelId(modelString)
    if (!providerId || !modelId) return undefined
    return { id: modelId, name: activeAgent?.modelName ?? modelId, provider: providerId }
  }, [activeAgent?.model, activeAgent?.modelName])

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of uiMessages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    return next
  }, [uiMessages])

  const finishRef = useRef<((executionId: string, event: ExecutionFinishEvent) => void) | undefined>(undefined)
  const {
    overlay,
    liveAssistants,
    disposeOverlay,
    reset: resetOverlay
  } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message }: ExecutionFinishEvent) => {
      void (async () => {
        try {
          await refresh()
        } catch (error) {
          logger.warn('Failed to refresh agent messages after execution finish', { sessionId, error })
        } finally {
          if (message.id) disposeOverlay(message.id)
        }
      })()
    },
    [disposeOverlay, refresh, sessionId]
  )
  finishRef.current = handleExecutionFinish

  // Deterministic overlay→DB handoff: the overlay's `onFinish` is suppressed when
  // the execution leaves `activeExecutions` at terminal, so a torn-down turn's
  // live card would otherwise override the finalized DB row. Refresh then drop the
  // overlay off the terminal status edge (excludes awaiting-approval, which keeps
  // its card). `refresh()` before `reset()` avoids flashing the stale base parts.
  useTopicOverlayHandoffOnTerminal(sessionTopicId, async () => {
    try {
      await refresh()
    } finally {
      resetOverlay()
    }
  })

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

  const displayMessages = useMemo(
    () => mergeLiveAgentMessages(uiMessages, liveAssistants),
    [liveAssistants, uiMessages]
  )

  const respondToolApproval = useCallback(
    async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
      const approvalId = match.approvalId

      const result = await window.api.ai.toolApproval.respond({
        approvalId,
        approved,
        reason,
        updatedInput,
        topicId: sessionTopicId,
        anchorId: match.messageId
      })

      if (!result.ok) throw new Error('Tool approval response was not accepted')
      await refresh()
    },
    [refresh, sessionTopicId]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const { isPending } = useTopicStreamStatus(sessionTopicId)

  const composerContext = useMemo<ComposerContextValue>(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  return {
    sessionId,
    uiMessages: displayMessages,
    partsByMessageId,
    isLoading,
    hasOlder,
    loadOlder,
    fallbackSnapshot,
    isPending,
    stop: chat.stop,
    sendMessage,
    deleteMessage,
    respondToolApproval,
    composerContext
  }
}
