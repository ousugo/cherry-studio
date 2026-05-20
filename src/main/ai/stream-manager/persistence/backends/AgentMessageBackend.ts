/**
 * Agents DB backend — writes assistant turns to the `session_messages`
 * table via `agentSessionMessageService`. The user message is persisted
 * by AgentChatContextProvider before streaming starts (not here).
 *
 * The listener folds any error into `finalMessage.parts` upstream, so a
 * single `persistAssistant` handles success / paused / error uniformly.
 */

import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { v7 as uuidv7 } from 'uuid'

import { finalizeInterruptedParts, type PersistAssistantInput, type PersistenceBackend } from '../PersistenceBackend'

export interface AgentMessageBackendOptions {
  /** Cherry Studio session id (not the SDK session id). */
  sessionId: string
  /** Agent id that owns the session. */
  agentId: string
  /** Model id used for this assistant message. */
  modelId?: UniqueModelId
  /** Claude Code / SDK session token for resume; empty string when unknown. */
  agentSessionId?: string | (() => string | undefined)
  /** Post-success hook — typically session auto-rename. */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class AgentMessageBackend implements PersistenceBackend {
  readonly kind = 'agents-db'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: AgentMessageBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status } = input
    const parts = finalizeInterruptedParts((finalMessage?.parts ?? []) as CherryMessagePart[], status)
    const agentSessionId = this.getAgentSessionId()
    await agentSessionMessageService.saveMessage({
      sessionId: this.opts.sessionId,
      ...(agentSessionId ? { agentSessionId } : {}),
      message: {
        id: finalMessage?.id ?? uuidv7(),
        role: 'assistant',
        status,
        data: { parts },
        modelId: this.opts.modelId
      }
    })
  }

  private getAgentSessionId(): string | undefined {
    return typeof this.opts.agentSessionId === 'function' ? this.opts.agentSessionId() : this.opts.agentSessionId
  }
}
