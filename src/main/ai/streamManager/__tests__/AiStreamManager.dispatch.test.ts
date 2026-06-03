import { BaseService } from '@main/core/lifecycle/BaseService'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamManagerConfig, StreamListener } from '../types'

// ── Mocks ───────────────────────────────────────────────────────────

// `dispatchStreamRequest` is the work `dispatch()` wraps in the per-topic lock.
// Replace it with a deferred so the test controls when each dispatch "completes"
// and can observe whether a second dispatch on the same topic waits its turn.
const dispatchEvents: string[] = []
const dispatchResolvers: Array<() => void> = []
const mockDispatchStreamRequest = vi.fn(
  (_manager: unknown, _subscriber: unknown, req: { topicId: string }): Promise<unknown> => {
    const seq = dispatchResolvers.length
    dispatchEvents.push(`start:${req.topicId}:${seq}`)
    return new Promise((resolve) => {
      dispatchResolvers.push(() => {
        dispatchEvents.push(`end:${req.topicId}:${seq}`)
        resolve({ mode: 'started' })
      })
    })
  }
)

vi.mock('../context', () => ({
  dispatchStreamRequest: mockDispatchStreamRequest
}))

// Boot-sweep reconcile reads/writes through MessageService.
const findPendingAssistantMessages = vi.fn<() => Promise<Array<{ id: string }>>>(async () => [])
const markMessagesError = vi.fn<(ids: string[]) => Promise<void>>(async () => undefined)
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    findPendingAssistantMessages: () => findPendingAssistantMessages(),
    markMessagesError: (ids: string[]) => markMessagesError(ids)
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { AiStreamManager } = await import('../AiStreamManager')

// ── Helpers ─────────────────────────────────────────────────────────

type ManagerInstance = InstanceType<typeof AiStreamManager>

function createManager(): ManagerInstance {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config?: Partial<AiStreamManagerConfig>) => ManagerInstance
  return new Ctor()
}

const fakeSubscriber = {} as StreamListener
const openReq = (topicId: string) => ({ trigger: 'submit-message', topicId, messages: [] }) as never

/** Drain pending microtasks + the async-mutex acquire (which resolves on a macrotask). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Resolve one outstanding dispatch and let the next queued waiter acquire the lock. */
async function settleDispatch(index: number): Promise<void> {
  dispatchResolvers[index]()
  await flush()
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AiStreamManager.dispatch — per-topic serialization', () => {
  let mgr: ManagerInstance

  beforeEach(() => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    findPendingAssistantMessages.mockResolvedValue([])
    mgr = createManager()
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('serializes two concurrent dispatches on the same topic — the second waits for the first', async () => {
    const p1 = mgr.dispatch(fakeSubscriber, openReq('t'))
    const p2 = mgr.dispatch(fakeSubscriber, openReq('t'))
    await flush()

    // Only the first has entered dispatchStreamRequest; the second is parked on the lock.
    expect(dispatchEvents).toEqual(['start:t:0'])

    await settleDispatch(0)
    await p1

    // First finished → second now runs.
    expect(dispatchEvents).toEqual(['start:t:0', 'end:t:0', 'start:t:1'])

    await settleDispatch(1)
    await p2
    expect(dispatchEvents).toEqual(['start:t:0', 'end:t:0', 'start:t:1', 'end:t:1'])
  })

  it('does not serialize dispatches on different topics — the lock is per-topic', async () => {
    const pa = mgr.dispatch(fakeSubscriber, openReq('a'))
    const pb = mgr.dispatch(fakeSubscriber, openReq('b'))
    await flush()

    // Both started concurrently — neither blocks the other.
    expect(dispatchEvents).toEqual(['start:a:0', 'start:b:1'])

    await settleDispatch(0)
    await settleDispatch(1)
    await Promise.all([pa, pb])
  })
})

describe('AiStreamManager.onInit — boot sweep ordering', () => {
  let mgr: ManagerInstance

  beforeEach(() => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    mgr = createManager()
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('flips orphaned pending → error before the Ai_Stream_Open handler is registered', async () => {
    const order: string[] = []
    findPendingAssistantMessages.mockResolvedValue([{ id: 'stale-1' }, { id: 'stale-2' }])
    markMessagesError.mockImplementation(async (ids: string[]) => {
      order.push(`sweep:${ids.join(',')}`)
    })
    vi.mocked(ipcMain.handle).mockImplementation(((channel: string) => {
      order.push(`register:${channel}`)
    }) as never)

    await (mgr as unknown as { onInit(): Promise<void> }).onInit()

    // Every stale row was flipped to `error` in one serialized write...
    expect(markMessagesError).toHaveBeenCalledWith(['stale-1', 'stale-2'])
    // ...and that write completed before any IPC handler — including the open
    // handler — was registered, so a fresh open can never race the sweep.
    const sweepIdx = order.indexOf('sweep:stale-1,stale-2')
    const openIdx = order.findIndex((e) => e === 'register:ai:stream:open')
    expect(sweepIdx).toBeGreaterThanOrEqual(0)
    expect(openIdx).toBeGreaterThan(sweepIdx)
  })
})
