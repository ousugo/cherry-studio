import { loggerService } from '@logger'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import { useCallback } from 'react'

const logger = loggerService.withContext('useToolApprovalBridge')

type ToolApprovalRespondFn = (args: MessageToolApprovalInput) => Promise<void> | void

/**
 * Tool-approval flow.
 *
 * The renderer is NOT a writer of approval state. It only delivers the
 * user's decision to Main via `Ai_ToolApproval_Respond`. Main is the single
 * authority: it applies the decision to the DB-authoritative anchor parts and
 * persists, then (Claude-Agent) resolves the live `canUseTool` or (MCP)
 * dispatches `continue-conversation` once every approval on the turn is
 * decided.
 * The previous design had the renderer PATCH `applyApprovalDecisions(...)`
 * itself, sourcing `before` from a DB-projected list that did not contain the
 * overlay-only `approval-requested` part — so the PATCH was a no-op that also
 * overwrote the persisted row with empty parts and raced Main's re-read,
 * causing the approval card to reappear on every click. Removed.
 */
export function useToolApprovalBridge(topicId: string): ToolApprovalRespondFn {
  return useCallback(
    async ({ match, approved, reason, updatedInput }) => {
      const approvalId = match.approvalId

      try {
        const result = await window.api.ai.toolApproval.respond({
          approvalId,
          approved,
          reason,
          updatedInput,
          topicId,
          anchorId: match.messageId
        })
        if (!result.ok) throw new Error('Tool approval response was not accepted')
      } catch (error) {
        logger.error('Failed to deliver tool-approval decision to main', {
          approvalId,
          approved,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    },
    [topicId]
  )
}
