import { classifyTurn } from '@shared/ai/transport'
import { useEffect, useRef } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

/**
 * The single invalidation signal for the v2 chat turn/approval state.
 *
 * When the topic's cross-window stream status transitions FROM live
 * (`pending`/`streaming`) TO any terminal (`done`/`aborted`/`error`/
 * `awaiting-approval`), call `refresh` once to re-read DB-authoritative
 * messages. Consumers (rendered list, approval card, message status)
 * then read fresh DB truth without each implementing their own scattered
 * status-string gate.
 *
 * Backed by the table-driven `classifyTurn` classifier so every
 * `TopicStreamStatus` value (including future additions) participates in
 * the gate by construction — no whack-a-mole on enum changes.
 */
export function useTopicDbRefreshOnTerminal(topicId: string, refresh: () => Promise<unknown>): void {
  const { status } = useTopicStreamStatus(topicId)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const prevRef = useRef<typeof status>(undefined)
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = status
    if (classifyTurn(prev).isStreamLive && classifyTurn(status).isTerminal) {
      void refreshRef.current().catch(() => {
        // Swallow — caller logs (`useChatWithHistory` warns); the invalidation
        // signal must not throw out of the React effect.
      })
    }
  }, [status])
}
