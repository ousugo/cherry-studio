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
  /** Live items reference (echoed for convenience). */
  items: T[]
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100

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
  const vlistHandleRef = useRef<VListHandle | null>(null)
  const smoothScroll = useSmoothScrollAnimation(scrollerRef)

  const atBottomStateRef = useRef<AtBottomState>(INITIAL_AT_BOTTOM_STATE)
  const lastWheelDirRef = useRef<'up' | 'down' | 'none'>('none')
  const lastScrollOffsetRef = useRef(0)
  const lastScrollSizeRef = useRef(0)

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
    const handle = vlistHandleRef.current
    if (!handle) return null
    return {
      offset: handle.scrollOffset,
      scrollSize: handle.scrollSize,
      viewportSize: handle.viewportSize
    }
  }, [])

  const targetBottomOffset = useCallback((): number => {
    const handle = vlistHandleRef.current
    if (!handle) return 0
    return Math.max(0, handle.scrollSize - handle.viewportSize)
  }, [])

  const stickToBottom = useCallback(
    (smooth: boolean) => {
      const el = scrollerRef.current
      if (!el) return
      if (smooth) {
        smoothScroll.scrollTo(targetBottomOffset)
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
      if (idx < 0 || !handle) return
      // Compute the target offset manually so we can route through the same
      // RAF smooth-scroll as auto-stick, instead of relying on virtua's
      // native (non-cancellable) `smooth: true`.
      const itemOffset = handle.getItemOffset(idx)
      if (smooth) {
        smoothScroll.scrollTo(() => itemOffset)
      } else {
        smoothScroll.cancel()
        const el = scrollerRef.current
        if (el) el.scrollTop = itemOffset
      }
    },
    [findItemIndex, smoothScroll]
  )

  // ---- size-change autoscroll -----------------------------------------

  useEffect(() => {
    // After every items update, re-measure and decide whether to stick.
    const m = readMetrics()
    if (!m) return
    const prevSize = lastScrollSizeRef.current
    if (m.scrollSize !== prevSize) {
      const wasAtBottom = atBottomStateRef.current.atBottom
      atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
        type: 'size-change',
        offset: m.offset,
        scrollSize: m.scrollSize,
        viewportSize: m.viewportSize,
        prevScrollSize: prevSize
      })
      lastScrollSizeRef.current = m.scrollSize
      // Auto-stick: if user was at bottom before this size change and the
      // size grew past the viewport, scroll smoothly to follow.
      if (wasAtBottom && m.scrollSize > prevSize) {
        stickToBottom(true)
      }
    }
  }, [items, readMetrics, stickToBottom])

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
    const m = readMetrics()
    if (!m) return
    lastScrollOffsetRef.current = m.offset
    lastScrollSizeRef.current = m.scrollSize
    const dir = lastWheelDirRef.current
    // If a wheel direction is hot, treat this as user-initiated.
    if (dir !== 'none') {
      atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
        type: 'user-scroll',
        direction: dir,
        offset: m.offset,
        scrollSize: m.scrollSize,
        viewportSize: m.viewportSize
      })
    } else {
      atBottomStateRef.current = reduceAtBottom(atBottomStateRef.current, {
        type: 'measure',
        offset: m.offset,
        scrollSize: m.scrollSize,
        viewportSize: m.viewportSize
      })
    }
  }, [readMetrics])

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
    vlistHandleRef,
    itemElement: itemElement as ChatVirtualizerRuntime<T>['itemElement'],
    keepMounted,
    scrollerProps: { onWheel, onScroll, onScrollEnd },
    findItemIndex,
    items
  }
}
