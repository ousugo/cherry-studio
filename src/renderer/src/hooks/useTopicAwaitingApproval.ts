/**
 * "Topic is paused waiting for the user to approve/deny a tool call."
 *
 * Reads the single cross-window source of truth: the `awaiting-approval`
 * value on the `topic.stream.statuses.${topicId}` shared-cache entry, written
 * by Main when it pauses on an `approval-requested` tool part and cleared
 * cross-window the moment the continue stream broadcasts `pending`.
 *
 * Previously this scanned the per-window `partsMap` for an
 * `approval-requested` ToolUIPart, which lagged behind SWR revalidation and
 * was inconsistent across windows. The shared cache makes it instant and
 * identical in every window.
 */

import { classifyTurn } from '@shared/ai/transport'

import { useTopicStreamStatus } from './useTopicStreamStatus'

export function useTopicAwaitingApproval(topicId: string): boolean {
  return classifyTurn(useTopicStreamStatus(topicId).status).isAwaitingApproval
}
