/**
 * Chat-behavior runtime for the message virtualizer.
 *
 * Composes three pure pieces with virtua's `<Virtualizer>`:
 *
 *   1. `atBottomStateMachine` — tracks whether the user is pinned to the
 *      bottom, including the user-scrolled-up latch that has to survive
 *      subsequent size-change events.
 *   2. `useSmoothScrollAnimation` — RAF-driven scroll that cancels cleanly
 *      on wheel-up; used for auto-stick during streaming and for the
 *      "user message to viewport top" send-message UX.
 *   3. A lightweight selection collector — reads `data-message-index`
 *      from the focused selection's ancestor and feeds the index into
 *      virtua's `keepMounted`, so a user's text selection survives the
 *      message being scrolled off-screen.
 *
 * The handle exposed here intentionally matches the legacy
 * `MessageVirtualListHandle` shape so callers (MessageList, anchor line,
 * navigation buttons) don't change.
 */

import {
  type CSSProperties,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { VListHandle } from 'virtua'

import { type AtBottomState, INITIAL_AT_BOTTOM_STATE, reduceAtBottom } from './atBottomStateMachine'
import { useSmoothScrollAnimation } from './useSmoothScrollAnimation'

export interface MessageVirtualListHandle {
  scrollToBottom(behavior?: ScrollBehavior): void
  scrollToKey(key: string, align?: 'start' | 'center' | 'end'): void
  isAtBottom(): boolean
  getScrollElement(): HTMLElement | null
}

export interface ChatVirtualizerRuntimeOptions<T> {
  items: T[]
  getItemKey(item: T, index: number): string
  onReachTop?(): void
  hasMoreTop: boolean
  handleRef?: Ref<MessageVirtualListHandle>
  topReachOverscanItems: number
  /**
   * Changes when the caller wants the message with this key scrolled to
   * the viewport top. Typically the latest user message after send.
   */
  scrollToTopKey?: string
}

interface ScrollerEventHandlers {
  onWheel(event: React.WheelEvent<HTMLElement>): void
  /** Wired into virtua's `onScroll(offset)` callback. */
  onScroll(offset: number): void
  onScrollEnd(): void
}

export interface ChatVirtualizerRuntime<T> {
  scrollerRef: RefObject<HTMLDivElement | null>
  /**
   * Ref for the inner content wrapper (the div that contains Virtualizer +
   * any padding). We observe this with a ResizeObserver to detect content
   * growth that doesn't change the `items` array — notably streaming text
   * appended to the last message, which mutates `partsByMessageId` but
   * leaves `groupedMessages` reference-stable.
   */
  contentRef: RefObject<HTMLDivElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  itemElement: (props: { index: number; style: CSSProperties; children: React.ReactNode }) => React.ReactElement
  keepMounted: readonly number[]
  scrollerProps: ScrollerEventHandlers
  /**
   * Find the item index for a given group key. Returns -1 if not found.
   * Exposed so callers can implement key-based scrolling without us
   * re-implementing list traversal.
   */
  findItemIndex(key: string): number
  /**
   * Extra bottom-padding the caller should apply so the scroll-pin anchor
   * (user message at viewport top) is reachable even when natural content
   * is shorter than `anchorOffset + viewportHeight`. Decays to 0 as the
   * assistant response grows into it.
   */
  anchorBottomPaddingPx: number
  /** Live items reference (echoed for convenience). */
  items: T[]
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100
/**
 * How far (in pixels) the user must scroll away from the pinned anchor
 * before we release the pin. Below this we treat tiny shifts (browser
 * layout reflow, sub-pixel rounding) as noise and re-pin instead.
 */
const PIN_RELEASE_TOLERANCE_PX = 16

export function useChatVirtualizerRuntime<T>({
  items,
  getItemKey,
  onReachTop,
  hasMoreTop,
  handleRef,
  topReachOverscanItems,
  scrollToTopKey
}: ChatVirtualizerRuntimeOptions<T>): ChatVirtualizerRuntime<T> {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)

  const atBottomStateRef = useRef<AtBottomState>(INITIAL_AT_BOTTOM_STATE)
  const lastWheelDirRef = useRef<'up' | 'down' | 'none'>('none')
  const lastScrollOffsetRef = useRef(0)
  const lastScrollSizeRef = useRef(0)

  // Scroll anchor: when the user sends a message, we "pin" that message's
  // top to the viewport top. `anchorOffsetRef` is the absolute scrollTop
  // we want maintained; `anchorBottomPaddingPx` is the extra empty space
  // appended after the virtualizer so the anchor offset is reachable when
  // natural content is shorter than the viewport. Pin releases on user
  // scroll past `PIN_RELEASE_TOLERANCE_PX`; padding then decays as new
  // content grows into it.
  const anchorOffsetRef = useRef<number | null>(null)
  const [anchorBottomPaddingPx, setAnchorBottomPaddingPx] = useState(0)
  const pendingScrollTargetRef = useRef<number | null>(null)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const getItemKeyRef = useRef(getItemKey)
  getItemKeyRef.current = getItemKey

  const findItemIndex = useCallback((key: string): number => {
    const list = itemsRef.current
    const get = getItemKeyRef.current
    for (let i = 0; i < list.length; i++) {
      if (get(list[i], i) === key) return i
    }
    return -1
  }, [])

  const readMetrics = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return null
    return {
      offset: el.scrollTop,
      scrollSize: el.scrollHeight,
      viewportSize: el.clientHeight
    }
  }, [])

  const targetBottomOffset = useCallback((): number => {
    const el = scrollerRef.current
    if (!el) return 0
    return Math.max(0, el.scrollHeight - el.clientHeight)
  }, [])

  const stickToBottom = useCallback(
    (smooth: boolean) => {
      const el = scrollerRef.current
      if (!el) return
      // Explicit scroll-to-bottom releases any scroll-to-top pin — caller
      // is asking to land at the bottom, not stay at the user-message
      // anchor.
      anchorOffsetRef.current = null
      if (smooth) {
        // The in-flight smooth animation already resamples targetBottomOffset
        // every frame, so it naturally follows a growing scroll size. If we
        // restart on every chunk, the RAF gets cancelled before any frame
        // can fire (chunks arrive faster than 16 ms), and scrollTop never
        // actually advances — the scrollbar reflects the new scrollSize but
        // the position stays put: a visual "flash" instead of smooth motion.
        if (!smoothScroll.isAnimating()) {
          smoothScroll.scrollTo(targetBottomOffset)
        }
      } else {
        smoothScroll.cancel()
        el.scrollTop = targetBottomOffset()
      }
      atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
        type: 'programmatic-stick'
      })
    },
    [smoothScroll, targetBottomOffset]
  )

  const scrollKeyToTop = useCallback(
    (key: string, smooth: boolean) => {
      const idx = findItemIndex(key)
      const handle = vlistHandleRef.current
      const el = scrollerRef.current
      if (idx < 0 || !handle || !el) return
      const idealOffset = handle.getItemOffset(idx)
      anchorOffsetRef.current = idealOffset
      // Compute extra padding needed so the anchor offset becomes reachable
      // (scrollTop max = scrollHeight - viewportHeight).
      const naturalScroll = el.scrollHeight - anchorBottomPaddingPx
      const needed = Math.max(0, idealOffset + el.clientHeight - naturalScroll)
      if (needed > anchorBottomPaddingPx) {
        // Padding has to apply first; defer the scroll until the layout
        // effect tied to anchorBottomPaddingPx fires.
        pendingScrollTargetRef.current = idealOffset
        setAnchorBottomPaddingPx(needed)
      } else if (smooth) {
        smoothScroll.scrollTo(() => idealOffset)
      } else {
        smoothScroll.cancel()
        el.scrollTop = idealOffset
      }
    },
    [anchorBottomPaddingPx, findItemIndex, smoothScroll]
  )

  // Fire deferred scroll once the bottom-padding state has been laid out.
  useLayoutEffect(() => {
    const target = pendingScrollTargetRef.current
    if (target == null) return
    pendingScrollTargetRef.current = null
    smoothScroll.scrollTo(() => target)
  }, [anchorBottomPaddingPx, smoothScroll])

  // ---- size-change autoscroll -----------------------------------------

  // ResizeObserver fires on any DOM growth in the scroll content — covering
  // both "new items rendered" (items array changed) and "existing streaming
  // item got more tokens" (items array reference-stable but DOM grew).
  // The latter is the dominant chat case: PR 2's identity-stability keeps
  // groupedMessages reference-equal across token chunks, so an items-based
  // effect would miss every chunk after the first.
  const handleSizeChange = useCallback(() => {
    const m = readMetrics()
    if (!m) return
    const prevSize = lastScrollSizeRef.current
    if (m.scrollSize === prevSize) return
    lastScrollSizeRef.current = m.scrollSize

    const anchorOffset = anchorOffsetRef.current
    if (anchorOffset != null) {
      // Anchor is pinned: maintain the invariant `scrollHeight >=
      // anchorOffset + viewportHeight` by adjusting bottom padding. As
      // natural content (assistant streaming) grows, the needed padding
      // shrinks 1:1 so the user's visual position never drifts.
      const naturalScroll = m.scrollSize - anchorBottomPaddingPx
      const needed = Math.max(0, anchorOffset + m.viewportSize - naturalScroll)
      if (needed !== anchorBottomPaddingPx) {
        setAnchorBottomPaddingPx(needed)
      }
      // Browser may shift scrollTop a bit during padding/layout reflow;
      // re-pin if it drifted but not enough to count as user input.
      const el = scrollerRef.current
      if (el && Math.abs(m.offset - anchorOffset) > 0 && Math.abs(m.offset - anchorOffset) < PIN_RELEASE_TOLERANCE_PX) {
        el.scrollTop = anchorOffset
      }
      return
    }

    // Anchor released: decay any leftover anchor padding as content fills,
    // so the scroller's max-scroll converges back to natural content size.
    if (anchorBottomPaddingPx > 0) {
      const grewBy = m.scrollSize - prevSize
      if (grewBy > 0) {
        setAnchorBottomPaddingPx(Math.max(0, anchorBottomPaddingPx - grewBy))
      }
    }

    // Standard auto-stick: if user was at bottom and content grew, follow.
    const wasAtBottom = atBottomStateRef.current.atBottom
    atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
      type: 'size-change',
      offset: m.offset,
      scrollSize: m.scrollSize,
      viewportSize: m.viewportSize,
      prevScrollSize: prevSize
    })
    if (wasAtBottom && m.scrollSize > prevSize) {
      stickToBottom(true)
    }
  }, [anchorBottomPaddingPx, readMetrics, stickToBottom])

  useLayoutEffect(() => {
    const target = contentRef.current
    if (!target || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => handleSizeChange())
    observer.observe(target)
    return () => observer.disconnect()
  }, [handleSizeChange])

  // ---- scrollToTopKey: scroll the named item to the viewport top ------

  const lastScrollToTopKeyRef = useRef<string | undefined>(undefined)
  const didMountForScrollKeyRef = useRef(false)

  useEffect(() => {
    const previous = lastScrollToTopKeyRef.current
    lastScrollToTopKeyRef.current = scrollToTopKey
    if (!didMountForScrollKeyRef.current) {
      didMountForScrollKeyRef.current = true
      return
    }
    if (!scrollToTopKey || scrollToTopKey === previous) return
    // Defer one frame so virtua has measured any items added in the same render.
    const raf = requestAnimationFrame(() => scrollKeyToTop(scrollToTopKey, true))
    return () => cancelAnimationFrame(raf)
  }, [scrollKeyToTop, scrollToTopKey])

  // ---- initial scroll: pin to bottom on mount -------------------------

  const didInitialPinRef = useRef(false)
  useEffect(() => {
    if (didInitialPinRef.current) return
    if (items.length === 0) return
    didInitialPinRef.current = true
    const raf = requestAnimationFrame(() => {
      const el = scrollerRef.current
      const handle = vlistHandleRef.current
      if (!el || !handle) return
      el.scrollTop = Math.max(0, handle.scrollSize - handle.viewportSize)
      atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
        type: 'programmatic-stick'
      })
      lastScrollSizeRef.current = handle.scrollSize
    })
    return () => cancelAnimationFrame(raf)
  }, [items.length])

  // ---- scroll / wheel handlers ---------------------------------------

  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      const dir: 'up' | 'down' | 'none' = event.deltaY < 0 ? 'up' : event.deltaY > 0 ? 'down' : 'none'
      // If user wheels upward mid-animation, kill the auto-stick.
      if (smoothScroll.isAnimating() && dir === 'up') {
        smoothScroll.cancel()
      }
      lastWheelDirRef.current = dir
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = setTimeout(() => {
        lastWheelDirRef.current = 'none'
      }, SCROLL_WHEEL_DEBOUNCE_MS)
    },
    [smoothScroll]
  )

  const onScroll = useCallback(() => {
    // Programmatic scrolls (our own smooth animation) fire scroll events too.
    // If we don't ignore them here, mid-animation `measure` transitions will
    // flip atBottom → false (we're not yet at the bottom while moving),
    // poisoning the next size-change's `wasAtBottom` check and causing the
    // next chunk's auto-stick to be skipped — the symptom is "auto-scroll
    // happens but never reaches the bottom while streaming".
    if (smoothScroll.isAnimating()) return
    const m = readMetrics()
    if (!m) return
    // Release the pin if the user has scrolled meaningfully away from the
    // anchor — this is the "user wants free scroll" signal. We keep the
    // anchor's bottom padding in place; it will decay naturally as content
    // grows into it (see handleSizeChange).
    const anchorOffset = anchorOffsetRef.current
    if (anchorOffset != null && Math.abs(m.offset - anchorOffset) > PIN_RELEASE_TOLERANCE_PX) {
      anchorOffsetRef.current = null
    }
    // Infer direction from offset delta so keyboard / scrollbar drag /
    // touchpad pan (which don't fire wheel events) still register as user
    // intent. The wheel ref still wins when fresh — it's the most reliable
    // signal for direction reversal mid-flight.
    const wheelDir = lastWheelDirRef.current
    const delta = m.offset - lastScrollOffsetRef.current
    const direction: 'up' | 'down' | 'none' =
      wheelDir !== 'none' ? wheelDir : delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
    lastScrollOffsetRef.current = m.offset
    atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
      type: 'user-scroll',
      direction,
      offset: m.offset,
      scrollSize: m.scrollSize,
      viewportSize: m.viewportSize
    })
  }, [readMetrics, smoothScroll])

  const onScrollEnd = useCallback(() => {
    lastWheelDirRef.current = 'none'
  }, [])

  // ---- reach-top trigger ---------------------------------------------

  const onReachTopRef = useRef(onReachTop)
  onReachTopRef.current = onReachTop

  useEffect(() => {
    if (!hasMoreTop) return
    const handle = vlistHandleRef.current
    if (!handle) return
    const topmostIdx = handle.findItemIndex(handle.scrollOffset)
    if (topmostIdx < topReachOverscanItems) {
      onReachTopRef.current?.()
    }
  }, [hasMoreTop, items.length, topReachOverscanItems])

  // ---- selection-survival keepMounted --------------------------------

  const [selectionIndex, setSelectionIndex] = useState<number | null>(null)

  useEffect(() => {
    const handler = (): void => {
      const sel = typeof document !== 'undefined' ? document.getSelection() : null
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelectionIndex(null)
        return
      }
      const anchorNode = sel.anchorNode
      if (!anchorNode) {
        setSelectionIndex(null)
        return
      }
      const baseEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
      const indexed = baseEl?.closest('[data-message-index]')
      const idx = indexed ? Number(indexed.getAttribute('data-message-index')) : NaN
      setSelectionIndex(Number.isFinite(idx) ? idx : null)
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  const keepMounted = useMemo<readonly number[]>(
    () => (selectionIndex == null ? [] : [selectionIndex]),
    [selectionIndex]
  )

  // ---- item element ---------------------------------------------------

  const itemElement = useCallback(
    ({ index, style, children }: { index: number; style: CSSProperties; children: React.ReactNode }) => (
      <div data-message-index={index} style={style}>
        {children}
      </div>
    ),
    []
  )

  // ---- imperative API -------------------------------------------------

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom: (behavior = 'instant') => {
        stickToBottom(behavior === 'smooth')
      },
      scrollToKey: (key, align = 'start') => {
        const handle = vlistHandleRef.current
        const idx = findItemIndex(key)
        if (idx < 0 || !handle) return
        if (align === 'start') {
          scrollKeyToTop(key, true)
        } else {
          handle.scrollToIndex(idx, { align })
        }
      },
      isAtBottom: () => atBottomStateRef.current.atBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [findItemIndex, scrollKeyToTop, stickToBottom]
  )

  return {
    scrollerRef,
    contentRef,
    vlistHandleRef,
    itemElement: itemElement as ChatVirtualizerRuntime<T>['itemElement'],
    keepMounted,
    scrollerProps: { onWheel, onScroll, onScrollEnd },
    findItemIndex,
    anchorBottomPaddingPx,
    items
  }
}
