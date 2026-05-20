/**
 * Per-topic stream state read from the shared
 * `topic.stream.statuses.${topicId}` template key. Main owns the entry
 * (`AiStreamManager.broadcastTopicStatus` → `cacheService.setShared`),
 * each renderer reads only the topic it cares about.
 *
 * Terminal states linger in the Main-side shared entry (other consumers
 * — `useTopicDbRefreshOnTerminal`, `useChatWithHistory`, awaiting-approval
 * indicators — depend on this). The "user has already acknowledged the
 * fulfilled animation" bit is per-window UI state, kept off the schema
 * and stored as a casual memory-cache key keyed by topic. Cache pub/sub
 * is reused via `cacheService.subscribe`; the hook is just a thin
 * `useSyncExternalStore` wrapper.
 */

import { cacheService } from '@data/CacheService'
import { useSharedCache } from '@renderer/data/hooks/useCache'
import { type ActiveExecution, classifyTurn, type TopicStreamStatus } from '@shared/ai/transport'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

interface TopicStreamStatusView {
  status: TopicStreamStatus | undefined
  /** Live executions, paired with their anchor message id. Empty when no stream is active. */
  activeExecutions: ActiveExecution[]
  /**
   * Executions currently paused on a `tool-approval-request`, paired with
   * their anchor message id. Populated by Main when `exec.awaitingApproval`
   * is set; survives the exec's own terminal status (the MCP `needsApproval`
   * flow ends the stream cleanly via `done` while still awaiting). Single
   * cross-window authority for "which message is the approval anchor" —
   * read directly by `useIsActiveTurnTarget`, no message-parts scan.
   */
  awaitingApprovalAnchors: ActiveExecution[]
  /** `pending` (request sent, provider hasn't streamed yet) or `streaming` (chunks flowing) — both render as "busy". */
  isPending: boolean
  /** `done` AND this window hasn't marked it seen yet. */
  isFulfilled: boolean
  /** Mark the terminal indicator as consumed in this window (local only). */
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
