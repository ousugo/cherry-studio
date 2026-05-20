/**
 * Per-topic stream state read from the shared
 * `topic.stream.statuses.${topicId}` template key. Main owns the entry
 * (`AiStreamManager.broadcastTopicStatus` → `cacheService.setShared`),
 * each renderer reads only the topic it cares about.
 *
 * Terminal states linger in the Main-side entry until each window flips
 * its local `topic.stream.seen.${topicId}` flag, at which point the
 * fulfilled indicator stops surfacing in that window specifically. The
 * "seen" state is window-local so one window dismissing the badge
 * doesn't hide it in another.
 */

import { useCache, useSharedCache } from '@renderer/data/hooks/useCache'
import {
  type ActiveExecution,
  classifyTurn,
  type StreamPendingQueueItem,
  type TopicStreamStatus
} from '@shared/ai/transport'
import { useCallback, useMemo } from 'react'

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
  pendingQueue: StreamPendingQueueItem[]
  /** `pending` (request sent, provider hasn't streamed yet) or `streaming` (chunks flowing) — both render as "busy". */
  isPending: boolean
  /** `done` AND this window hasn't marked it seen yet. */
  isFulfilled: boolean
  /** Mark the terminal indicator as consumed in this window (local only). */
  markSeen: () => void
}

export function useTopicStreamStatus(topicId: string): TopicStreamStatusView {
  const [entry] = useSharedCache(`topic.stream.statuses.${topicId}` as const)
  const [seen, setSeen] = useCache(`topic.stream.seen.${topicId}` as const)

  const status = entry?.status
  const activeExecutions = useMemo(() => entry?.activeExecutions ?? [], [entry])
  const awaitingApprovalAnchors = useMemo(() => entry?.awaitingApprovalAnchors ?? [], [entry])
  const pendingQueue = useMemo(() => entry?.pendingQueue ?? [], [entry])

  const flags = classifyTurn(status)
  const isPending = flags.isStreamLive
  const isFulfilled = flags.isFulfilledCandidate && !seen

  const markSeen = useCallback(() => {
    if (!seen) setSeen(true)
  }, [seen, setSeen])

  return { status, activeExecutions, awaitingApprovalAnchors, pendingQueue, isPending, isFulfilled, markSeen }
}
