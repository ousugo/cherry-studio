// Per-topic stream state. Main owns the shared cache entry; the "fulfilled
// animation seen" bit is per-window and lives in a casual memory cache.

import { cacheService } from '@data/CacheService'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

interface TopicStreamStatusView {
  status: TopicStreamStatus | undefined
  activeExecutions: ActiveExecution[]
  /**
   * Survives the exec's own terminal status — MCP `needsApproval` ends the
   * stream via `done` while still awaiting. Single cross-window authority
   * for "which message is the approval anchor".
   */
  awaitingApprovalAnchors: ActiveExecution[]
  isPending: boolean
  /** `done` AND this window hasn't marked it seen yet. */
  isFulfilled: boolean
  markSeen: () => void
}

const seenKey = (topicId: string) => `topic.stream.seen.${topicId}`

function useTopicSeen(topicId: string): readonly [boolean, () => void] {
  const key = seenKey(topicId)
  const subscribe = useCallback((cb: () => void) => cacheService.subscribe(key, cb), [key])
  const getSnapshot = useCallback(() => cacheService.getCasual<boolean>(key) ?? false, [key])
  const seen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const mark = useCallback(() => cacheService.setCasual(key, true), [key])
  return [seen, mark] as const
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const [seen, markSeen] = useTopicSeen(topicId)

  const status = entry?.status
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const isFulfilled = flags.isFulfilledCandidate && !seen

  return { status, activeExecutions, awaitingApprovalAnchors, isPending, isFulfilled, markSeen }
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
