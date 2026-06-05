/**
 * reasoningTimingTransform.ts
 *
 * This module stabilizes the reasoning thinking time by calculating it before the stream
 * is split into broadcast (live renderer) and accumulated branches.
 *
 * Load-bearing Invariants:
 * 1. Must run before pipeStreamLoop's tee() so both broadcast chunks and the AI SDK accumulator
 *    receive the same performance.now() delta (preventing post-refresh value mismatch).
 * 2. The transform preserves provider metadata from reasoning-start when writing metadata onto
 *    reasoning-end. The AI SDK accumulator overwrites (not merges) the reasoning part's metadata
 *    on end:
 *      reasoningPart.providerMetadata = chunk.providerMetadata ?? reasoningPart.providerMetadata
 *    Without this re-merge, start-only metadata (e.g. claude-code.parentToolCallId) is dropped
 *    from the final persisted message.
 */

import { loggerService } from '@logger'
import type { ProviderMetadata, UIMessageChunk } from 'ai'

const logger = loggerService.withContext('reasoningTimingTransform')

type ReasoningEndChunk = Extract<UIMessageChunk, { type: 'reasoning-end' }>

export function withReasoningTimingMetadata(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  const reasoningById = new Map<string, { startedAt: number; providerMetadata?: ProviderMetadata }>()

  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === 'reasoning-start') {
          if (reasoningById.has(chunk.id)) {
            logger.debug('reasoning-start received for an id that was never ended; overwriting timing', {
              id: chunk.id
            })
          }
          reasoningById.set(chunk.id, {
            startedAt: performance.now(),
            providerMetadata: toProviderMetadata(chunk.providerMetadata)
          })
          controller.enqueue(chunk)
          return
        }

        if (chunk.type === 'reasoning-end') {
          const reasoning = reasoningById.get(chunk.id)
          if (reasoning) {
            reasoningById.delete(chunk.id)
            controller.enqueue(
              withThinkingMs(chunk, Math.round(performance.now() - reasoning.startedAt), reasoning.providerMetadata)
            )
            return
          }
          logger.debug('reasoning-end received with no matching reasoning-start; passing through', { id: chunk.id })
        }

        controller.enqueue(chunk)
      }
    })
  )
}

function withThinkingMs(
  chunk: ReasoningEndChunk,
  thinkingMs: number,
  startProviderMetadata: ProviderMetadata | undefined
): ReasoningEndChunk {
  const endProviderMetadata = toProviderMetadata(chunk.providerMetadata)
  const startCherry = isRecord(startProviderMetadata?.cherry) ? startProviderMetadata.cherry : {}
  const endCherry = isRecord(endProviderMetadata?.cherry) ? endProviderMetadata.cherry : {}

  return {
    ...chunk,
    providerMetadata: {
      ...startProviderMetadata,
      ...endProviderMetadata,
      cherry: {
        ...startCherry,
        ...endCherry,
        thinkingMs
      }
    }
  }
}

function toProviderMetadata(value: unknown): ProviderMetadata | undefined {
  return isRecord(value) ? (value as ProviderMetadata) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
