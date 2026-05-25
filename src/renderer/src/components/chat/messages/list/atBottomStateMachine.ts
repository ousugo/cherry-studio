/**
 * Pure reducer for the "is the message list pinned to the bottom?" state.
 *
 * The point of going through a state machine (vs computing `atBottom` per
 * render from current measurements) is to distinguish four near-identical
 * inputs that should produce different decisions:
 *
 *   1. User scrolled up by hand          → stop auto-sticking
 *   2. Content grew while at bottom      → auto-stick to new bottom
 *   3. Content grew while scrolled away  → leave scroll alone
 *   4. User scrolled back down to bottom → resume auto-sticking
 *
 * Without the latched state, case 2 is indistinguishable from case 3 at the
 * moment the size change fires (both produce `scrollOffset + viewportSize <
 * scrollSize` immediately after).
 *
 * Ported in spirit from message-list's `St` cell (see
 * wakaru-unpacked/06-cell-graph-and-actions.js:34-120), but with a flat
 * 2-state space and explicit reasons. We do not implement the 8-reason
 * cascade because the chat use case does not need to distinguish all of
 * them — `atBottom` + a single `becauseUserScrolledUp` flag is enough to
 * drive the autoscroll decision.
 */

export const DEFAULT_AT_BOTTOM_TOLERANCE_PX = 8

export type AtBottomReason = 'initial' | 'scrolled-to-bottom' | 'stuck-on-grow' | 'size-stayed-at-bottom'

export type NotAtBottomReason = 'initial' | 'user-scrolled-up' | 'scrolled-not-bottom' | 'size-grew-past-viewport'

export type AtBottomState =
  | { readonly atBottom: true; readonly reason: AtBottomReason }
  | { readonly atBottom: false; readonly reason: NotAtBottomReason }

export type AtBottomInput =
  | {
      readonly type: 'measure'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
    }
  | {
      readonly type: 'user-scroll'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
      readonly direction: 'up' | 'down' | 'none'
    }
  | {
      readonly type: 'size-change'
      readonly offset: number
      readonly scrollSize: number
      readonly viewportSize: number
      readonly prevScrollSize: number
    }
  | { readonly type: 'programmatic-stick' }
  | { readonly type: 'reset' }

export const INITIAL_AT_BOTTOM_STATE: AtBottomState = { atBottom: false, reason: 'initial' }

export function isCloseToBottom(
  offset: number,
  scrollSize: number,
  viewportSize: number,
  tolerance: number = DEFAULT_AT_BOTTOM_TOLERANCE_PX
): boolean {
  return scrollSize - offset - viewportSize <= tolerance
}

/**
 * Should the runtime auto-scroll to bottom when content has grown?
 *
 * Returns true only when the previous state had the user pinned to the
 * bottom — i.e. they were already there, or we put them there. If the user
 * actively scrolled up, we leave them alone even if growth happens.
 */
export function shouldStickOnGrow(state: AtBottomState): boolean {
  return state.atBottom
}

export function reduceAtBottom(
  state: AtBottomState,
  input: AtBottomInput,
  tolerance: number = DEFAULT_AT_BOTTOM_TOLERANCE_PX
): AtBottomState {
  switch (input.type) {
    case 'reset':
      return INITIAL_AT_BOTTOM_STATE

    case 'programmatic-stick':
      return { atBottom: true, reason: 'stuck-on-grow' }

    case 'measure': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        return state.atBottom ? state : { atBottom: true, reason: 'size-stayed-at-bottom' }
      }
      return state.atBottom ? { atBottom: false, reason: 'scrolled-not-bottom' } : state
    }

    case 'user-scroll': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        // Reaching the bottom always resumes auto-stick, regardless of prior
        // user-scrolled-up latch.
        return state.atBottom && state.reason === 'scrolled-to-bottom'
          ? state
          : { atBottom: true, reason: 'scrolled-to-bottom' }
      }
      // Not at bottom: if user scrolled upward, latch the user-intent reason
      // so it survives subsequent size-change events. A 'down' scroll that
      // didn't reach the bottom is a partial drag — also count as user intent.
      if (input.direction === 'up' || input.direction === 'down') {
        return { atBottom: false, reason: 'user-scrolled-up' }
      }
      // direction 'none' (programmatic) — keep prior reason if we already had
      // a user-intent latch; otherwise note the position only.
      if (!state.atBottom && state.reason === 'user-scrolled-up') return state
      return { atBottom: false, reason: 'scrolled-not-bottom' }
    }

    case 'size-change': {
      const close = isCloseToBottom(input.offset, input.scrollSize, input.viewportSize, tolerance)
      if (close) {
        return state.atBottom ? state : { atBottom: true, reason: 'size-stayed-at-bottom' }
      }
      // Size grew (or shrank) and we're no longer at the bottom. If the
      // previous state was at-bottom, the new content pushed us up; the
      // caller should auto-stick. If the previous state was a user-intent
      // latch, preserve it so we don't accidentally clear it.
      if (!state.atBottom && state.reason === 'user-scrolled-up') return state
      if (state.atBottom) return { atBottom: false, reason: 'size-grew-past-viewport' }
      return { atBottom: false, reason: 'scrolled-not-bottom' }
    }
  }
}
