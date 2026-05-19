import { usePersistCache } from '@data/hooks/useCache'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export const RESOURCE_LIST_PANE_MIN_WIDTH = 210
export const RESOURCE_LIST_PANE_DEFAULT_WIDTH = 275
export const RESOURCE_LIST_PANE_MAX_WIDTH = 360

export function clampResourceListPaneWidth(width: number): number {
  return Math.min(RESOURCE_LIST_PANE_MAX_WIDTH, Math.max(RESOURCE_LIST_PANE_MIN_WIDTH, Math.round(width)))
}

export function useResourceListPaneResize() {
  const [storedWidth, setStoredWidth] = usePersistCache('ui.chat.sidebar.width')
  const paneRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const isResizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const paneWidth = clampResourceListPaneWidth(storedWidth ?? RESOURCE_LIST_PANE_DEFAULT_WIDTH)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--assistants-width', `${paneWidth}px`)
  }, [paneWidth])

  useEffect(() => {
    return () => resizeCleanupRef.current?.()
  }, [])

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
        setStoredWidth(clampResourceListPaneWidth(moveEvent.clientX - paneLeft))
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
