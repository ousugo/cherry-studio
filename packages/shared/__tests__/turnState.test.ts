import { describe, expect, it } from 'vitest'

import type { TopicStreamStatus } from '../ai/transport'
import { classifyTurn, TURN_STATE, type TurnStateFlags } from '../ai/transport'

const ALL_STATUSES: TopicStreamStatus[] = ['pending', 'streaming', 'done', 'aborted', 'error', 'awaiting-approval']

describe('classifyTurn / TURN_STATE', () => {
  it('has a row for every TopicStreamStatus (exhaustive, no extras)', () => {
    expect(Object.keys(TURN_STATE).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('classifyTurn(status) returns the table row', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s)).toBe(TURN_STATE[s])
    }
  })

  it('classifyTurn(undefined) = no-stream (all flags false)', () => {
    expect(classifyTurn(undefined)).toEqual<TurnStateFlags>({
      isStreamLive: false,
      isTurnActive: false,
      isAwaitingApproval: false,
      isTerminal: false,
      isFulfilledCandidate: false
    })
  })

  it.each<[TopicStreamStatus, TurnStateFlags]>([
    ['pending', { isStreamLive: true, isTurnActive: true, isAwaitingApproval: false, isTerminal: false, isFulfilledCandidate: false }],
    ['streaming', { isStreamLive: true, isTurnActive: true, isAwaitingApproval: false, isTerminal: false, isFulfilledCandidate: false }],
    ['done', { isStreamLive: false, isTurnActive: false, isAwaitingApproval: false, isTerminal: true, isFulfilledCandidate: true }],
    ['aborted', { isStreamLive: false, isTurnActive: false, isAwaitingApproval: false, isTerminal: true, isFulfilledCandidate: false }],
    ['error', { isStreamLive: false, isTurnActive: false, isAwaitingApproval: false, isTerminal: true, isFulfilledCandidate: false }],
    [
      'awaiting-approval',
      { isStreamLive: false, isTurnActive: true, isAwaitingApproval: true, isTerminal: true, isFulfilledCandidate: false }
    ]
  ])('%s → expected flags', (status, expected) => {
    expect(classifyTurn(status)).toEqual(expected)
  })

  // Behavior-preservation guards for the Phase-0 consumer rewrites:
  it('isStreamLive == old (pending|streaming) — useTopicStreamStatus.isPending / Message.isTopicStreaming', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isStreamLive).toBe(s === 'pending' || s === 'streaming')
    }
  })

  it('isTerminal == old useChatWithHistory set (done|aborted|error|awaiting-approval)', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isTerminal).toBe(
        s === 'done' || s === 'aborted' || s === 'error' || s === 'awaiting-approval'
      )
    }
  })

  it('isAwaitingApproval == old useTopicAwaitingApproval (status === awaiting-approval)', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isAwaitingApproval).toBe(s === 'awaiting-approval')
    }
  })

  it('isFulfilledCandidate == old (status === done)', () => {
    for (const s of ALL_STATUSES) {
      expect(classifyTurn(s).isFulfilledCandidate).toBe(s === 'done')
    }
  })
})
