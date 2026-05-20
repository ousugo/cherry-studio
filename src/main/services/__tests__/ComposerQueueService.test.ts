import type { ComposerQueuedMessagePayload, ComposerQueueSnapshot } from '@shared/ai/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setSharedMock } = vi.hoisted(() => ({
  setSharedMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'CacheService') return { setShared: setSharedMock }
      return undefined
    })
  }
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

const { ComposerQueueService } = await import('../ComposerQueueService')

const payload = (text: string): ComposerQueuedMessagePayload => ({
  text,
  userMessageParts: [{ type: 'text', text }]
})

describe('ComposerQueueService', () => {
  let service: InstanceType<typeof ComposerQueueService>

  beforeEach(() => {
    setSharedMock.mockReset()
    service = new ComposerQueueService()
  })

  it('enqueues, updates, removes, and broadcasts draft queue snapshots', () => {
    const item = service.enqueue('topic-1', payload('first'))

    expect(item.payload.text).toBe('first')
    expect(service.snapshot('topic-1').items).toHaveLength(1)
    expect(setSharedMock).toHaveBeenLastCalledWith('composer.queue.drafts.topic-1', {
      scopeId: 'topic-1',
      items: [item]
    })

    const updated = service.update('topic-1', item.id, payload('updated'))
    expect(updated?.payload.text).toBe('updated')
    expect(updated?.status).toBe('queued')

    service.remove('topic-1', item.id)
    expect(service.snapshot('topic-1').items).toEqual([])
  })

  it('reorders known items and appends items missing from the requested order', () => {
    const first = service.enqueue('topic-1', payload('first'))
    const second = service.enqueue('topic-1', payload('second'))
    const third = service.enqueue('topic-1', payload('third'))

    service.reorder('topic-1', [third.id, first.id])

    expect(service.snapshot('topic-1').items.map((item) => item.id)).toEqual([third.id, first.id, second.id])
  })

  it('claims only one queued item at a time and keeps failed items claimable after update', () => {
    const first = service.enqueue('topic-1', payload('first'))
    const second = service.enqueue('topic-1', payload('second'))

    expect(service.claimNext('topic-1')?.id).toBe(first.id)
    expect(service.claimNext('topic-1')).toBeNull()

    service.complete('topic-1', first.id)
    expect(service.claimNext('topic-1')?.id).toBe(second.id)
    expect(service.claimNext('topic-1')).toBeNull()

    service.fail('topic-1', second.id, 'network')
    expect(service.claimNext('topic-1')).toBeNull()

    service.update('topic-1', second.id, payload('retry'))
    expect(service.claimNext('topic-1')?.id).toBe(second.id)
  })

  it('keeps previous snapshots immutable when claim changes item status', () => {
    const item = service.enqueue('topic-1', payload('first'))
    const firstBroadcast = setSharedMock.mock.calls[0][1] as ComposerQueueSnapshot
    const firstSnapshot = service.snapshot('topic-1')

    const claimed = service.claimNext('topic-1')
    const claimBroadcast = setSharedMock.mock.calls[1][1] as ComposerQueueSnapshot

    expect(item.status).toBe('queued')
    expect(firstBroadcast.items[0].status).toBe('queued')
    expect(firstSnapshot.items[0].status).toBe('queued')
    expect(claimed?.status).toBe('sending')
    expect(claimBroadcast.items[0]).toMatchObject({ id: item.id, status: 'sending' })
    expect(setSharedMock).toHaveBeenCalledTimes(2)
  })

  it('removes completed items', () => {
    const item = service.enqueue('topic-1', payload('first'))

    service.claimNext('topic-1')
    service.complete('topic-1', item.id)

    expect(service.snapshot('topic-1').items).toEqual([])
  })
})
