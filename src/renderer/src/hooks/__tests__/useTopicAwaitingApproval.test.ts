import type { TopicStreamStatus } from '@shared/ai/transport'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '../../data/CacheService'

const mockEntry =
  vi.fn<
    () =>
      | {
          status: TopicStreamStatus | undefined
          turnId?: string
          activeExecutions: []
          awaitingApprovalAnchors: []
        }
      | undefined
  >()

// Mock at the cache layer rather than at useTopicStreamStatus — intra-module
// vi.mock can't intercept calls between functions in the same source file.
vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: () => [mockEntry()]
}))

import { useTopicAwaitingApproval, useTopicStreamStatus } from '../useTopicStreamStatus'

const seenKey = (topicId: string) => `topic.stream.seen.${topicId}` as never

const setEntry = (status: TopicStreamStatus | undefined, turnId?: string) => {
  mockEntry.mockReturnValue({ status, turnId, activeExecutions: [], awaitingApprovalAnchors: [] })
}

describe('useTopicAwaitingApproval', () => {
  beforeEach(() => {
    mockEntry.mockReset()
    cacheService.delete(seenKey('t'))
  })

  it('is true iff the cross-window shared-cache status is awaiting-approval', () => {
    setEntry('awaiting-approval')
    expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(true)
  })

  it.each<TopicStreamStatus | undefined>(['pending', 'streaming', 'aborted', 'done', 'error', undefined])(
    'is false for status %s (no per-window partsMap scan / SWR dependency)',
    (status) => {
      setEntry(status)
      expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(false)
    }
  )

  it('treats each stream turn as unread until that specific turn is marked seen', () => {
    setEntry('done', 'turn-1')

    const { result, rerender } = renderHook(() => useTopicStreamStatus('t'))

    expect(result.current.isFulfilled).toBe(true)

    act(() => {
      result.current.markSeen()
    })
    rerender()

    expect(result.current.isFulfilled).toBe(false)

    setEntry('done', 'turn-2')
    rerender()

    expect(result.current.isFulfilled).toBe(true)
  })
})
