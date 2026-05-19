import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSmoothStream } from '../useSmoothStream'

/**
 * Controllable requestAnimationFrame: callbacks are queued; `flush(time)`
 * invokes every callback scheduled so far with the given timestamp. Because
 * `renderLoop` reschedules by calling rAF again, each `flush` advances exactly
 * one "generation" of the loop.
 */
let rafCallbacks: FrameRequestCallback[] = []
let rafId = 0

function flush(time: number, generations = 1): void {
  for (let g = 0; g < generations; g++) {
    const batch = rafCallbacks
    rafCallbacks = []
    for (const cb of batch) cb(time)
  }
}

beforeEach(() => {
  rafCallbacks = []
  rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb)
    return ++rafId
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSmoothStream', () => {
  it('reveals queued text progressively', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    act(() => result.current.addChunk('abc'))
    // 3 chars, 1 grapheme/frame (floor(3/5)=0 → max 1)
    act(() => flush(1))
    act(() => flush(2))
    act(() => flush(3))

    expect(onUpdate).toHaveBeenLastCalledWith('abc')
  })

  // Regression: the renderLoop used to terminate the instant the queue drained
  // to exactly 0 mid-stream (step 6 had no `else`), and the effect only
  // restarts it when `streamDone`/`minDelay` change — so a later `addChunk`
  // was never consumed and the UI froze until stream end. The loop must stay
  // alive while the stream is not done.
  it('keeps revealing after the queue drains to zero mid-stream', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSmoothStream({ onUpdate, streamDone: false, minDelay: 0 }))

    // Burst 1 — drain it completely to 0 (this is what killed the old loop).
    act(() => result.current.addChunk('abc'))
    act(() => flush(1, 3))
    expect(onUpdate).toHaveBeenLastCalledWith('abc')

    // Simulate a backend gap: several empty frames while still streaming.
    act(() => flush(2, 5))

    // Burst 2 arrives AFTER the queue was emptied. With the bug the loop is
    // dead and this never shows; with the fix it reveals.
    act(() => result.current.addChunk('def'))
    act(() => flush(3, 5))

    expect(onUpdate).toHaveBeenLastCalledWith('abcdef')
  })

  it('stops and shows final text once streamDone with an empty queue', () => {
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }: { done: boolean }) => useSmoothStream({ onUpdate, streamDone: done, minDelay: 0 }),
      { initialProps: { done: false } }
    )

    act(() => result.current.addChunk('hi'))
    act(() => flush(1, 3))
    expect(onUpdate).toHaveBeenLastCalledWith('hi')

    rerender({ done: true })
    // Queue empty + streamDone → top branch finalizes and does NOT reschedule.
    act(() => flush(2))
    const callsAfterDone = onUpdate.mock.calls.length
    act(() => flush(3, 5))
    // No further rAF scheduled → no extra onUpdate churn.
    expect(onUpdate.mock.calls.length).toBe(callsAfterDone)
    expect(onUpdate).toHaveBeenLastCalledWith('hi')
  })
})
