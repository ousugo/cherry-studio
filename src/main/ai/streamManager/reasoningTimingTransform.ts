import type { UIMessageChunk } from 'ai'

type ReasoningEndChunk = Extract<UIMessageChunk, { type: 'reasoning-end' }>
type ProviderMetadata = Record<string, unknown>

export function withReasoningTimingMetadata(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  const reasoningById = new Map<string, { startedAt: number; providerMetadata?: ProviderMetadata }>()

  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === 'reasoning-start') {
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
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
