import { application } from '@main/core/application'
import type { ActiveExecution, StreamPendingQueueItem, TopicStreamStatus } from '@shared/ai/transport'
import type { Message } from '@shared/data/types/message'

import type { ActiveStream } from '../types'
import type { StreamLifecycle } from './StreamLifecycle'

/**
 * Chat strategy: cross-window status broadcast (`topic.stream.statuses.<topicId>`),
 * attach re-enabled, 30 s grace-period before eviction.
 */
export function createChatStreamLifecycle(gracePeriodMs: number): StreamLifecycle {
  const toPendingPayload = (message: Message): StreamPendingQueueItem['payload'] => {
    const parts = message.data.parts ?? []
    const text = parts
      .map((part) => (part.type === 'text' && 'text' in part ? part.text : ''))
      .filter(Boolean)
      .join('\n')

    return {
      text,
      userMessageParts: parts
    }
  }

  const broadcast = (stream: ActiveStream, status: TopicStreamStatus) => {
    const activeExecutions: ActiveExecution[] = []
    const awaitingApprovalAnchors: ActiveExecution[] = []
    const pendingById = new Map<string, StreamPendingQueueItem>()

    for (const [modelId, exec] of stream.executions) {
      const entry: ActiveExecution = { executionId: modelId, anchorMessageId: exec.anchorMessageId }
      if (exec.status === 'streaming') activeExecutions.push(entry)
      // Main-side authoritative approval-anchor identity; renderer reads this
      // instead of inferring from `parts` / SWR-lagged status.
      if (exec.awaitingApproval) awaitingApprovalAnchors.push(entry)

      for (const message of exec.pendingMessages.list()) {
        const existing = pendingById.get(message.id)
        if (existing) {
          existing.executionIds.push(modelId)
          continue
        }
        pendingById.set(message.id, {
          id: message.id,
          payload: toPendingPayload(message),
          executionIds: [modelId],
          createdAt: message.createdAt
        })
      }
    }

    const cacheService = application.get('CacheService')
    const key = `topic.stream.statuses.${stream.topicId}` as const
    const prev = cacheService.getShared(key)
    const lastCompletedAt = status === 'done' ? Date.now() : prev?.lastCompletedAt
    cacheService.setShared(key, {
      status,
      turnId: stream.turnId,
      activeExecutions,
      awaitingApprovalAnchors,
      pendingQueue: [...pendingById.values()],
      lastCompletedAt
    })
  }

  return {
    name: 'chat',
    onCreated(stream) {
      broadcast(stream, 'pending')
    },
    onPromotedToStreaming(stream) {
      broadcast(stream, 'streaming')
    },
    onQueueChanged(stream) {
      broadcast(stream, stream.status)
    },
    onTerminal(stream) {
      broadcast(stream, stream.status)
    },
    canAttach() {
      return true
    },
    cleanup(stream, evict) {
      stream.expiresAt = Date.now() + gracePeriodMs
      stream.cleanupTimer = setTimeout(evict, gracePeriodMs)
    }
  }
}
