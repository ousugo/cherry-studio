import type { AiStreamOpenRequest, AiStreamOpenResponse } from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { streamDispatchCoordinator } from '../streamDispatchCoordinator'

const TOPIC = 'topic-1'
const req: AiStreamOpenRequest = { trigger: 'submit-message', topicId: TOPIC, userMessageParts: [] }

let streamOpen: ReturnType<typeof vi.fn>
let originalApi: unknown

beforeEach(() => {
  streamOpen = vi.fn()
  originalApi = (window as unknown as { api: unknown }).api
  ;(window as unknown as { api: unknown }).api = { ...(originalApi as object), ai: { streamOpen } }
})
afterEach(() => {
  ;(window as unknown as { api: unknown }).api = originalApi
  vi.clearAllMocks()
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('streamDispatchCoordinator', () => {
  it('routes a resolved ack to subscribers', async () => {
    const ack: AiStreamOpenResponse = {
      mode: 'started',
      userMessageId: 'u-1',
      placeholderIds: ['a-1', 'a-2']
    }
    streamOpen.mockResolvedValue(ack)
    const seen: unknown[] = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()

    expect(streamOpen).toHaveBeenCalledWith(req)
    expect(seen).toEqual([{ ok: true, topicId: TOPIC, ack }])
    off()
  })

  it('routes a rejected dispatch as an error result', async () => {
    streamOpen.mockRejectedValue(new Error('ipc boom'))
    const seen: Array<{ ok: boolean }> = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))

    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ ok: false, topicId: TOPIC })
    off()
  })

  it('peek() returns the latest result for late subscribers', async () => {
    const ack: AiStreamOpenResponse = { mode: 'started', placeholderIds: ['a-1'] }
    streamOpen.mockResolvedValue(ack)
    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()
    expect(streamDispatchCoordinator.peek(TOPIC)).toEqual({ ok: true, topicId: TOPIC, ack })
  })

  it('unsubscribe stops further delivery', async () => {
    streamOpen.mockResolvedValue({ mode: 'started' })
    const seen: unknown[] = []
    const off = streamDispatchCoordinator.subscribe(TOPIC, (r) => seen.push(r))
    off()
    streamDispatchCoordinator.dispatch(TOPIC, req)
    await flush()
    expect(seen).toHaveLength(0)
  })
})
