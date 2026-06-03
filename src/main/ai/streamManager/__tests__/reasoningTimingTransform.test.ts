import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pipeStreamLoop } from '../pipeStreamLoop'
import { withReasoningTimingMetadata } from '../reasoningTimingTransform'

function streamFrom(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk))
      controller.close()
    }
  })
}

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader()
  const chunks: UIMessageChunk[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return chunks
}

function cherryMeta(chunk: UIMessageChunk): Record<string, unknown> | undefined {
  const metadata =
    'providerMetadata' in chunk ? (chunk.providerMetadata as Record<string, unknown> | undefined) : undefined
  return metadata?.cherry as Record<string, unknown> | undefined
}

describe('withReasoningTimingMetadata', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds thinkingMs to reasoning-end chunks', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(432)

    const chunks = await collect(
      withReasoningTimingMetadata(
        streamFrom([
          { type: 'reasoning-start', id: 'r1' } as UIMessageChunk,
          { type: 'reasoning-delta', id: 'r1', delta: 'thinking' } as UIMessageChunk,
          { type: 'reasoning-end', id: 'r1' } as UIMessageChunk,
          { type: 'text-start', id: 't1' } as UIMessageChunk,
          { type: 'text-delta', id: 't1', delta: 'answer' } as UIMessageChunk
        ])
      )
    )

    expect(cherryMeta(chunks[2])?.thinkingMs).toBe(332)
  })

  it('preserves existing provider metadata and cherry fields', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(35)

    const chunks = await collect(
      withReasoningTimingMetadata(
        streamFrom([
          { type: 'reasoning-start', id: 'r1' } as UIMessageChunk,
          {
            type: 'reasoning-end',
            id: 'r1',
            providerMetadata: {
              openai: { itemId: 'provider-item' },
              cherry: { existing: true }
            }
          } as UIMessageChunk
        ])
      )
    )

    const reasoningEnd = chunks[1] as UIMessageChunk & {
      providerMetadata: { openai: Record<string, unknown>; cherry: Record<string, unknown> }
    }
    expect(reasoningEnd.providerMetadata.openai).toEqual({ itemId: 'provider-item' })
    expect(reasoningEnd.providerMetadata.cherry).toEqual({ existing: true, thinkingMs: 25 })
  })

  it('merges reasoning-start provider metadata into the reasoning-end chunk', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(35)

    const chunks = await collect(
      withReasoningTimingMetadata(
        streamFrom([
          {
            type: 'reasoning-start',
            id: 'r1',
            providerMetadata: {
              'claude-code': { parentToolCallId: 'parent-tool' },
              cherry: { transport: 'claude-agent' }
            }
          } as UIMessageChunk,
          {
            type: 'reasoning-end',
            id: 'r1',
            providerMetadata: {
              openai: { itemId: 'provider-item' },
              cherry: { existing: true }
            }
          } as UIMessageChunk
        ])
      )
    )

    const reasoningEnd = chunks[1] as UIMessageChunk & {
      providerMetadata: {
        'claude-code': Record<string, unknown>
        openai: Record<string, unknown>
        cherry: Record<string, unknown>
      }
    }
    expect(reasoningEnd.providerMetadata['claude-code']).toEqual({ parentToolCallId: 'parent-tool' })
    expect(reasoningEnd.providerMetadata.openai).toEqual({ itemId: 'provider-item' })
    expect(reasoningEnd.providerMetadata.cherry).toEqual({
      transport: 'claude-agent',
      existing: true,
      thinkingMs: 25
    })
  })

  it('tracks multiple reasoning ids independently', async () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(350)
      .mockReturnValueOnce(550)

    const chunks = await collect(
      withReasoningTimingMetadata(
        streamFrom([
          { type: 'reasoning-start', id: 'a' } as UIMessageChunk,
          { type: 'reasoning-start', id: 'b' } as UIMessageChunk,
          { type: 'reasoning-end', id: 'a' } as UIMessageChunk,
          { type: 'reasoning-end', id: 'b' } as UIMessageChunk
        ])
      )
    )

    expect(cherryMeta(chunks[2])?.thinkingMs).toBe(250)
    expect(cherryMeta(chunks[3])?.thinkingMs).toBe(350)
  })

  it('feeds the same thinkingMs into broadcast chunks and the accumulated final message', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(450).mockReturnValueOnce(1000)

    const broadcastChunks: UIMessageChunk[] = []
    const result = await pipeStreamLoop(
      withReasoningTimingMetadata(
        streamFrom([
          { type: 'start' } as UIMessageChunk,
          { type: 'reasoning-start', id: 'r1' } as UIMessageChunk,
          { type: 'reasoning-delta', id: 'r1', delta: 'steady thought' } as UIMessageChunk,
          { type: 'reasoning-end', id: 'r1' } as UIMessageChunk,
          { type: 'text-start', id: 't1' } as UIMessageChunk,
          { type: 'text-delta', id: 't1', delta: 'answer' } as UIMessageChunk,
          { type: 'text-end', id: 't1' } as UIMessageChunk,
          { type: 'finish' } as UIMessageChunk
        ])
      ),
      new AbortController().signal,
      {
        onChunk: (chunk) => broadcastChunks.push(chunk)
      }
    )

    const broadcastReasoningEnd = broadcastChunks.find((chunk) => chunk.type === 'reasoning-end')
    const finalReasoningPart = result.finalMessage?.parts.find((part) => part.type === 'reasoning') as
      | { providerMetadata?: { cherry?: { thinkingMs?: number } } }
      | undefined

    expect(cherryMeta(broadcastReasoningEnd!)?.thinkingMs).toBe(350)
    expect(finalReasoningPart?.providerMetadata?.cherry?.thinkingMs).toBe(350)
    expect(result.finalMessage?.parts.find((part) => part.type === 'text')).toMatchObject({ text: 'answer' })
  })

  it('preserves reasoning-start provider metadata in the accumulated final message', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(450).mockReturnValueOnce(1000)

    const result = await pipeStreamLoop(
      withReasoningTimingMetadata(
        streamFrom([
          { type: 'start' } as UIMessageChunk,
          {
            type: 'reasoning-start',
            id: 'r1',
            providerMetadata: {
              'claude-code': { parentToolCallId: 'parent-tool' },
              cherry: { transport: 'claude-agent' }
            }
          } as UIMessageChunk,
          { type: 'reasoning-delta', id: 'r1', delta: 'steady thought' } as UIMessageChunk,
          { type: 'reasoning-end', id: 'r1' } as UIMessageChunk,
          { type: 'finish' } as UIMessageChunk
        ])
      ),
      new AbortController().signal,
      { onChunk: () => {} }
    )

    const finalReasoningPart = result.finalMessage?.parts.find((part) => part.type === 'reasoning') as
      | { providerMetadata?: Record<string, unknown> }
      | undefined

    expect(finalReasoningPart?.providerMetadata?.['claude-code']).toEqual({ parentToolCallId: 'parent-tool' })
    expect(finalReasoningPart?.providerMetadata?.cherry).toEqual({
      transport: 'claude-agent',
      thinkingMs: 350
    })
  })
})
