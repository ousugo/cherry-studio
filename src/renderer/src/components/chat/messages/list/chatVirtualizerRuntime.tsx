/**
 * Chat-behavior runtime for the message virtualizer (orchestrator).
 *
 * Composes four focused hooks:
 *
 *   - `useAtBottomTracker` — pure at-bottom state machine wrapper.
 *   - `useAutoStickToBottom` — auto-follow stream when at bottom.
 *   - `useScrollAnchor` — pin a list item to viewport top via a spacer
 *     item appended to virtua's data array (so virtua's measurement +
 *     scrollToIndex handles offsets, not us).
 *   - `useSmoothScrollAnimation` — RAF + cancel-on-wheel.
 */

import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
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

import { useAtBottomTracker } from './useAtBottomTracker'
import { useAutoStickToBottom } from './useAutoStickToBottom'
import { useScrollAnchor } from './useScrollAnchor'
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
  renderItem(item: T, index: number): ReactNode
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

/**
 * The runtime wraps the caller's items so it can transparently append a
 * spacer item (for scroll-anchor padding). MessageVirtualList passes the
 * wrapped values straight through to virtua's `<Virtualizer>`.
 */
export type WrappedItem<T> =
  | { kind: 'data'; key: string; value: T; originalIndex: number }
  | { kind: 'spacer'; key: '__anchor_spacer__'; height: number }

export interface ChatVirtualizerRuntime<T> {
  scrollerRef: RefObject<HTMLDivElement | null>
  /**
   * Ref for the inner content wrapper observed by ResizeObserver — catches
   * DOM size changes (item growth from streaming text, new items added,
   * spacer-height changes).
   */
  contentRef: RefObject<HTMLDivElement | null>
  vlistHandleRef: RefObject<VListHandle | null>
  /** Wrapped items array to pass to virtua's `<Virtualizer data>`. */
  wrappedItems: WrappedItem<T>[]
  /** virtua's `getItemKey` over wrapped items. */
  wrappedGetItemKey(item: WrappedItem<T>, index: number): string
  /** Render function for wrapped items (spacer is rendered as an empty div). */
  wrappedRenderItem(item: WrappedItem<T>, index: number): ReactElement
  keepMounted: readonly number[]
  scrollerProps: ScrollerEventHandlers
}

const SCROLL_WHEEL_DEBOUNCE_MS = 100

export function useChatVirtualizerRuntime<T>({
  items,
  getItemKey,
  renderItem,
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

  const atBottom = useAtBottomTracker()
  const anchor = useScrollAnchor({ scrollerRef, vlistHandleRef, smoothScroll })
  const autoStick = useAutoStickToBottom({
    scrollerRef,
    smoothScroll,
    isAtBottom: atBottom.isAtBottom,
    isLocked: anchor.isPinned,
    markStuck: atBottom.notifyProgrammaticStick
  })

  // ---- wrap items so the anchor's spacer is included ------------------

  const itemsRef = useRef(items)
  itemsRef.current = items
  const getItemKeyRef = useRef(getItemKey)
  getItemKeyRef.current = getItemKey
  const renderItemRef = useRef(renderItem)
  renderItemRef.current = renderItem

  const wrappedItems = useMemo<WrappedItem<T>[]>(() => {
    const base = items.map<WrappedItem<T>>((value, i) => ({
      kind: 'data',
      key: getItemKey(value, i),
      value,
      originalIndex: i
    }))
    if (anchor.spacerHeight > 0) {
      base.push({ kind: 'spacer', key: '__anchor_spacer__', height: anchor.spacerHeight })
    }
    return base
  }, [items, getItemKey, anchor.spacerHeight])

  const wrappedGetItemKey = useCallback((item: WrappedItem<T>) => (item.kind === 'spacer' ? item.key : item.key), [])

  const wrappedRenderItem = useCallback((item: WrappedItem<T>) => {
    if (item.kind === 'spacer') {
      return <div aria-hidden="true" style={{ height: item.height, width: '100%' }} />
    }
    // Tag with data-message-index so the selectionchange listener can
    // map a text selection back to a data index for keepMounted.
    return (
      <div data-message-index={item.originalIndex} style={{ width: '100%' }}>
        {renderItemRef.current(item.value, item.originalIndex)}
      </div>
    )
  }, [])

  const findDataIndexByKey = useCallback((key: string): number => {
    const list = itemsRef.current
    const get = getItemKeyRef.current
    for (let i = 0; i < list.length; i++) {
      if (get(list[i], i) === key) return i
    }
    return -1
  }, [])

  // ---- ResizeObserver: dispatch to anchor + auto-stick ----------------

  useLayoutEffect(() => {
    const content = contentRef.current
    const scroller = scrollerRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Anchor first: it may adjust spacer height. Auto-stick reads
      // scrollHeight after, so any pin-driven layout change is reflected.
      anchor.onContentSizeChange()
      autoStick.onContentSizeChange()
      // Feed the at-bottom tracker so its state machine stays current.
      const el = scrollerRef.current
      if (el) {
        atBottom.notifySizeChange({
          offset: el.scrollTop,
          scrollSize: el.scrollHeight,
          viewportSize: el.clientHeight,
          prevScrollSize: 0
        })
      }
    })
    observer.observe(content)
    // Also observe the scroller — the composer can expand (long paste) and
    // shrink the viewport without changing content height. Without this, the
    // spacer stays sized for the old viewport and turns into phantom scroll
    // room below the messages.
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [anchor, atBottom, autoStick])

  // ---- scrollToTopKey trigger: pin the named item ---------------------

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
    const idx = findDataIndexByKey(scrollToTopKey)
    if (idx < 0) return
    anchor.pinTo(idx)
  }, [anchor, findDataIndexByKey, scrollToTopKey])

  // ---- initial scroll: pin to bottom on mount -------------------------

  const didInitialPinRef = useRef(false)
  useEffect(() => {
    if (didInitialPinRef.current) return
    if (items.length === 0) return
    didInitialPinRef.current = true
    const raf = requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (!el) return
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      atBottom.notifyProgrammaticStick()
    })
    return () => cancelAnimationFrame(raf)
  }, [atBottom, items.length])

  // ---- scroll / wheel handlers ---------------------------------------

  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelDirRef = useRef<'up' | 'down' | 'none'>('none')
  const lastScrollOffsetRef = useRef(0)

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      const dir: 'up' | 'down' | 'none' = event.deltaY < 0 ? 'up' : event.deltaY > 0 ? 'down' : 'none'
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
    // Programmatic scrolls (smooth-stick animation) fire scroll events; if
    // we don't ignore them, the at-bottom tracker would flip atBottom→false
    // mid-animation because scrollTop is still en route.
    if (smoothScroll.isAnimating()) return
    const el = scrollerRef.current
    if (!el) return
    const offset = el.scrollTop
    const scrollSize = el.scrollHeight
    const viewportSize = el.clientHeight
    anchor.onUserScroll(offset)
    const wheelDir = lastWheelDirRef.current
    const delta = offset - lastScrollOffsetRef.current
    const direction: 'up' | 'down' | 'none' =
      wheelDir !== 'none' ? wheelDir : delta < 0 ? 'up' : delta > 0 ? 'down' : 'none'
    lastScrollOffsetRef.current = offset
    atBottom.notifyScroll({ offset, scrollSize, viewportSize, direction })
  }, [anchor, atBottom, smoothScroll])

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

  // ---- imperative API -------------------------------------------------

  useImperativeHandle(
    handleRef,
    (): MessageVirtualListHandle => ({
      scrollToBottom: (behavior = 'instant') => {
        // Explicit scroll-to-bottom releases any anchor — caller wants the
        // absolute bottom, not the user-message-top position.
        anchor.release()
        const el = scrollerRef.current
        if (!el) return
        const target = Math.max(0, el.scrollHeight - el.clientHeight)
        if (behavior === 'smooth') {
          if (!smoothScroll.isAnimating()) {
            smoothScroll.scrollTo(() =>
              Math.max(0, (scrollerRef.current?.scrollHeight ?? 0) - (scrollerRef.current?.clientHeight ?? 0))
            )
          }
        } else {
          smoothScroll.cancel()
          el.scrollTop = target
        }
        atBottom.notifyProgrammaticStick()
      },
      scrollToKey: (key, align = 'start') => {
        const handle = vlistHandleRef.current
        const idx = findDataIndexByKey(key)
        if (idx < 0 || !handle) return
        anchor.release()
        handle.scrollToIndex(idx, { align, smooth: true })
      },
      isAtBottom: atBottom.isAtBottom,
      getScrollElement: () => scrollerRef.current
    }),
    [anchor, atBottom, findDataIndexByKey, smoothScroll]
  )

  return {
    scrollerRef,
    contentRef,
    vlistHandleRef,
    wrappedItems,
    wrappedGetItemKey,
    wrappedRenderItem: wrappedRenderItem as ChatVirtualizerRuntime<T>['wrappedRenderItem'],
    keepMounted,
    scrollerProps: { onWheel, onScroll, onScrollEnd }
  }
}

// Item-element wrapper kept here for reference / future tagging; currently
// the wrapped renderItem path adds `data-message-index` via the item's own
// children (renderItem caller). If selection-survival per-item attribute
// becomes desirable again, re-introduce by wrapping wrappedRenderItem.
export type ItemElement = (props: {
  index: number
  style: CSSProperties
  children: React.ReactNode
}) => React.ReactElement
