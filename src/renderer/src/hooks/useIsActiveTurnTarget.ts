import type { Message } from '@renderer/types/newMessage'
import { isMessageProcessing } from '@renderer/utils/messageUtils/is'

import { useTopicAwaitingApproval } from './useTopicAwaitingApproval'
import { useTopicStreamStatus } from './useTopicStreamStatus'

/**
 * Is THIS message the active target of the current turn?
 *
 * Single per-message identity predicate — the per-message equivalent of the
 * topic-level `classifyTurn`. Combines the three authoritative
 * non-staleable signals that identify "this is the message Main is/was
 * working on right now", so each consumer no longer rebuilds the OR (and
 * gets it slightly wrong, e.g. over-scoping a topic-level signal to user
 * messages):
 *
 *  1. `isMessageProcessing(message)` — DB `status` PENDING/PROCESSING/
 *     SEARCHING. Per-message; covers the freshly-sent assistant placeholder
 *     where the optimistic status is set before any shared-cache broadcast.
 *  2. `activeExecutions[].anchorMessageId === message.id` — shared-cache
 *     cross-window registry of live executions. Covers the continue-stream
 *     tool-execution window where `message.status` hasn't been
 *     re-fetched by SWR yet (and is therefore stale 'paused' or 'success').
 *  3. `message.status === 'paused' && isAwaitingApproval` — per-message DB
 *     status pinpoints the approval anchor; the topic classifier confirms
 *     semantics (paused-for-approval, not user-aborted). No part scan.
 *
 * Returns false for user messages and for older completed assistants by
 * construction — none of the three signals match them. Use everywhere a
 * consumer gates "this message is busy / show beat-loader / hide menubar".
 */
export function useIsActiveTurnTarget(message: Message): boolean {
  const { activeExecutions } = useTopicStreamStatus(message.topicId)
  const isAwaitingApproval = useTopicAwaitingApproval(message.topicId)
  if (isMessageProcessing(message)) return true
  if (activeExecutions.some((e) => e.anchorMessageId === message.id)) return true
  if (message.status === 'paused' && isAwaitingApproval) return true
  return false
}
