import type { TopicStreamStatus } from '@shared/ai/transport'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useTopicAwaitingApproval } from '../useTopicAwaitingApproval'

const mockStatus = vi.fn<() => TopicStreamStatus | undefined>()

vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: mockStatus(),
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    isPending: false,
    isFulfilled: false,
    markSeen: () => {}
  })
}))

describe('useTopicAwaitingApproval', () => {
  it('is true iff the cross-window shared-cache status is awaiting-approval', () => {
    mockStatus.mockReturnValue('awaiting-approval')
    expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(true)
  })

  it.each<TopicStreamStatus | undefined>(['pending', 'streaming', 'aborted', 'done', 'error', undefined])(
    'is false for status %s (no per-window partsMap scan / SWR dependency)',
    (status) => {
      mockStatus.mockReturnValue(status)
      expect(renderHook(() => useTopicAwaitingApproval('t')).result.current).toBe(false)
    }
  )
})
