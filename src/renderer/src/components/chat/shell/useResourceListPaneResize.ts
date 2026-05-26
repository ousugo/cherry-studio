import { usePersistCache } from '@data/hooks/useCache'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export const RESOURCE_LIST_PANE_DEFAULT_WIDTH = 240
export const RESOURCE_LIST_PANE_MIN_WIDTH = 240
export const RESOURCE_LIST_PANE_MAX_WIDTH = 360
export const RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD = 200

export function clampResourceListPaneWidth(width: number): number {
  return Math.min(RESOURCE_LIST_PANE_MAX_WIDTH, Math.max(RESOURCE_LIST_PANE_MIN_WIDTH, Math.round(width)))
}

interface ResourceListPaneResizeOptions {
  onPaneCollapse?: () => void
}

export function useResourceListPaneResize({ onPaneCollapse }: ResourceListPaneResizeOptions = {}) {
  const [storedWidth, setStoredWidth] = usePersistCache('ui.chat.sidebar.width')
  const paneRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const isResizingRef = useRef(false)
  const pendingPaneCollapseRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const paneWidth = clampResourceListPaneWidth(storedWidth ?? RESOURCE_LIST_PANE_DEFAULT_WIDTH)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--assistants-width', `${paneWidth}px`)
  }, [paneWidth])

  useEffect(() => {
    return () => resizeCleanupRef.current?.()
  }, [])

  useEffect(() => {
    if (isResizing || !pendingPaneCollapseRef.current) return

    pendingPaneCollapseRef.current = false
    onPaneCollapse?.()
  }, [isResizing, onPaneCollapse])

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()

      isResizingRef.current = true
      setIsResizing(true)

      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const paneLeft = paneRef.current?.getBoundingClientRect().left ?? 0
      const startClientX = event.clientX

      const cleanup = () => {
        isResizingRef.current = false
        setIsResizing(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return
        const nextWidth = moveEvent.clientX - paneLeft
        const dragDelta = moveEvent.clientX - startClientX
        if (nextWidth < RESOURCE_LIST_PANE_MIN_WIDTH && dragDelta <= -RESOURCE_LIST_PANE_COLLAPSE_DRAG_THRESHOLD) {
          setStoredWidth(RESOURCE_LIST_PANE_DEFAULT_WIDTH)
          pendingPaneCollapseRef.current = true
          cleanup()
          return
        }
        setStoredWidth(clampResourceListPaneWidth(nextWidth))
      }

      const onMouseUp = () => cleanup()

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [setStoredWidth]
  )

  return {
    isResizing,
    paneRef,
    paneWidth,
    startResizing
  }
}
