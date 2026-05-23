// Per-topic stream state. Main owns the shared cache entry; the "fulfilled
// animation seen" bit is per-window and lives in a casual memory cache.

import { cacheService } from '@data/CacheService'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import {
  type ActiveExecution,
  classifyTurn,
  type StreamPendingQueueItem,
  type TopicStreamStatus
} from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

export type TopicStreamSeenValue = boolean | string

interface TopicStreamStatusView {
  status: TopicStreamStatus | undefined
  activeExecutions: ActiveExecution[]
  /**
   * Survives the exec's own terminal status — MCP `needsApproval` ends the
   * stream via `done` while still awaiting. Single cross-window authority
   * for "which message is the approval anchor".
   */
  awaitingApprovalAnchors: ActiveExecution[]
  pendingQueue: StreamPendingQueueItem[]
  isPending: boolean
  /** `done` AND this window hasn't marked it seen yet. */
  isFulfilled: boolean
  markSeen: () => void
}

const seenKey = (topicId: string) => `topic.stream.seen.${topicId}`

export function isTopicStreamTurnSeen(seen: TopicStreamSeenValue | undefined, turnId?: string): boolean {
  return turnId ? seen === turnId : seen === true
}

function useTopicSeen(topicId: string, turnId?: string): readonly [boolean, () => void] {
  const key = seenKey(topicId)
  const subscribe = useCallback((cb: () => void) => cacheService.subscribe(key, cb), [key])
  const getSnapshot = useCallback(() => cacheService.getCasual<TopicStreamSeenValue>(key), [key])
  const seen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const mark = useCallback(() => cacheService.setCasual<TopicStreamSeenValue>(key, turnId ?? true), [key, turnId])
  return [isTopicStreamTurnSeen(seen, turnId), mark] as const
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)

  const status = entry?.status
  const turnId = entry?.turnId
  const [seen, markSeen] = useTopicSeen(topicId, turnId)
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])
  const pendingQueue = useMemo(() => entry?.pendingQueue ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const isFulfilled = flags.isFulfilledCandidate && !seen

  return { status, activeExecutions, awaitingApprovalAnchors, pendingQueue, isPending, isFulfilled, markSeen }
}

export function useTopicAwaitingApproval(topicId: string): boolean {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  return classifyTurn(entry?.status).isAwaitingApproval
}

// Fire `refresh` once per live→terminal transition. Gate is `classifyTurn`-driven
// so new TopicStreamStatus values participate by construction.
export function useTopicDbRefreshOnTerminal(topicId: string, refresh: () => Promise<unknown>): void {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const status = entry?.status
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const prevRef = useRef<typeof status>(undefined)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    if (classifyTurn(prev).isStreamLive && classifyTurn(status).isTerminal) {
      void refreshRef.current().catch(() => {
        // Caller logs; the invalidation signal must not throw out of the effect.
      })
    }
  }, [status])
}
