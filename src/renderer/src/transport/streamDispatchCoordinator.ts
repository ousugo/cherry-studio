/**
 * Owns the `streamOpen` dispatch and surfaces its ack, decoupled from the
 * AI SDK `Chat`/transport.
 *
 * `IpcChatTransport.sendMessages` used to fire `streamOpen` and discard the
 * resolved `AiStreamOpenResponse` (`.catch()` only). That response carries
 * the authoritative DB ids (`userMessageId` / `placeholderIds`) the renderer
 * needs to reconcile optimistic bubbles. Routing the *single* existing
 * dispatch through this coordinator makes the ack observable without a
 * second dispatch and without coupling it to `Chat` state.
 *
 * Phase 1.5 ships the coordinator only; the pending-UI consumer arrives in
 * Phase 4 via `subscribe`.
 */
import { loggerService } from '@logger'
import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'

const logger = loggerService.withContext('streamDispatchCoordinator')

export type StreamDispatchResult =
  | { ok: true; topicId: string; ack: AiStreamOpenResponse }
  | { ok: false; topicId: string; error: Error }

type Listener = (result: StreamDispatchResult) => void

const listeners = new Map<string, Set<Listener>>()
const lastAckByTopic = new Map<string, StreamDispatchResult>()

function notify(result: StreamDispatchResult): void {
  lastAckByTopic.set(result.topicId, result)
  const subs = listeners.get(result.topicId)
  if (!subs) return
  for (const cb of [...subs]) {
    try {
      cb(result)
    } catch (err) {
      logger.warn('stream dispatch listener threw', { topicId: result.topicId, err })
    }
  }
}

export const streamDispatchCoordinator = {
  /**
   * Trigger the (single) `streamOpen` dispatch for a topic and route its
   * resolution/rejection to subscribers. Fire-and-forget for the caller —
   * the chunk listener stream is built independently by the transport.
   */
  dispatch(topicId: string, request: AiStreamOpenRequest): void {
    window.api.ai
      .streamOpen(request)
      .then((ack) => notify({ ok: true, topicId, ack }))
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('streamOpen IPC failed', err)
        notify({ ok: false, topicId, error: err })
      })
  },

  /** Subscribe to dispatch results for a topic. Returns an unsubscribe fn. */
  subscribe(topicId: string, listener: Listener): () => void {
    let subs = listeners.get(topicId)
    if (!subs) {
      subs = new Set()
      listeners.set(topicId, subs)
    }
    subs.add(listener)
    return () => {
      subs.delete(listener)
      if (subs.size === 0) listeners.delete(topicId)
    }
  },

  /** Most recent dispatch result for a topic, if any (late-subscriber catch-up). */
  peek(topicId: string): StreamDispatchResult | undefined {
    return lastAckByTopic.get(topicId)
  }
}
