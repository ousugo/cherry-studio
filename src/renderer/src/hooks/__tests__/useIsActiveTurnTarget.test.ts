import type { ActiveExecution } from '@shared/ai/transport'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '../../types/newMessage'
import { useIsActiveTurnTarget } from '../useIsActiveTurnTarget'

const isMessageProcessingMock = vi.fn<(m: Message) => boolean>()
vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageProcessing: (m: Message) => isMessageProcessingMock(m)
}))

const activeExecutionsMock = vi.fn<() => ActiveExecution[]>(() => [])
vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({
    status: undefined,
    activeExecutions: activeExecutionsMock(),
    isPending: false,
    isFulfilled: false,
    markSeen: () => {}
  })
}))

const isAwaitingApprovalMock = vi.fn<() => boolean>(() => false)
vi.mock('../useTopicAwaitingApproval', () => ({
  useTopicAwaitingApproval: () => isAwaitingApprovalMock()
}))

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    topicId: 't',
    role: 'assistant',
    status: 'success' as never,
    ...overrides
  } as Message
}

describe('useIsActiveTurnTarget', () => {
  beforeEach(() => {
    isMessageProcessingMock.mockReset().mockReturnValue(false)
    activeExecutionsMock.mockReset().mockReturnValue([])
    isAwaitingApprovalMock.mockReset().mockReturnValue(false)
  })

  it('true when `isMessageProcessing` is true (per-message DB status PENDING/PROCESSING/SEARCHING)', () => {
    isMessageProcessingMock.mockReturnValue(true)
    expect(renderHook(() => useIsActiveTurnTarget(msg())).result.current).toBe(true)
  })

  it('true when this message id is listed in `activeExecutions` (continue stream / live target)', () => {
    isMessageProcessingMock.mockReturnValue(false)
    activeExecutionsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'm1' }])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1' }))).result.current).toBe(true)
  })

  it('true when message.status === "paused" AND topic is awaiting approval (the approval anchor)', () => {
    isMessageProcessingMock.mockReturnValue(false)
    isAwaitingApprovalMock.mockReturnValue(true)
    expect(renderHook(() => useIsActiveTurnTarget(msg({ status: 'paused' as never }))).result.current).toBe(true)
  })

  it('false for a user message (none of the three signals match)', () => {
    isMessageProcessingMock.mockReturnValue(false)
    isAwaitingApprovalMock.mockReturnValue(true) // topic awaiting — must NOT leak to user
    expect(renderHook(() => useIsActiveTurnTarget(msg({ role: 'user', status: 'success' as never }))).result.current).toBe(false)
  })

  it('false for an old completed assistant (status success, not in activeExecutions, not paused)', () => {
    isMessageProcessingMock.mockReturnValue(false)
    activeExecutionsMock.mockReturnValue([{ executionId: 'p::m', anchorMessageId: 'OTHER' }])
    expect(renderHook(() => useIsActiveTurnTarget(msg({ id: 'm1', status: 'success' as never }))).result.current).toBe(false)
  })

  it('false for a paused message when the topic is NOT awaiting (user-aborted-with-content path)', () => {
    isMessageProcessingMock.mockReturnValue(false)
    isAwaitingApprovalMock.mockReturnValue(false)
    expect(renderHook(() => useIsActiveTurnTarget(msg({ status: 'paused' as never }))).result.current).toBe(false)
  })
})

