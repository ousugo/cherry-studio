import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { cn } from '@renderer/utils'
import { motion } from 'motion/react'
import type { ReactNode, Ref } from 'react'
import { useEffect, useRef } from 'react'

import { OverlayHost } from './OverlayHost'
import { PageSidebar } from './PageSidebar'
import { RightPaneHost } from './RightPaneHost'
import { CHAT_SHELL_TRANSITION, type ChatPanePosition } from './types'

const RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH = 540

interface ChatAppShellBaseProps {
  topBar?: ReactNode
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  sidePanel?: ReactNode
  centerOverlay?: ReactNode
  /** Overlay scoped to the center area but rendered above the center's transform/stacking layer. */
  centerTopOverlay?: ReactNode
  overlay?: ReactNode
  rootId?: string
  rootClassName?: string
  contentId?: string
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
  onPaneCollapse?: () => void
}

type ChatAppShellMainProps = ChatAppShellBaseProps & {
  main: ReactNode
  bottomComposer?: ReactNode
  centerContent?: never
}

type ChatAppShellCenterContentProps = ChatAppShellBaseProps & {
  centerContent: ReactNode
  main?: never
  bottomComposer?: never
}

export type ChatAppShellProps = ChatAppShellMainProps | ChatAppShellCenterContentProps

export function ChatAppShell({
  topBar,
  pane,
  paneOpen,
  panePosition = 'left',
  main,
  centerContent,
  bottomComposer,
  sidePanel,
  centerOverlay,
  centerTopOverlay,
  overlay,
  rootId,
  rootClassName,
  contentId,
  centerId,
  centerRef,
  centerClassName,
  onPaneCollapse
}: ChatAppShellProps) {
  const hasCenterContent = centerContent !== undefined
  const leftPaneOpen = Boolean(paneOpen && panePosition === 'left')
  const rootRef = useRef<HTMLDivElement>(null)
  const leftPaneOpenRef = useRef(leftPaneOpen)
  const onPaneCollapseRef = useRef(onPaneCollapse)
  const previousShellWidthRef = useRef<number | null>(null)

  useEffect(() => {
    leftPaneOpenRef.current = leftPaneOpen
    onPaneCollapseRef.current = onPaneCollapse
  }, [leftPaneOpen, onPaneCollapse])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      const previousShellWidth = previousShellWidthRef.current
      const nextShellWidth = entry.contentRect.width
      previousShellWidthRef.current = nextShellWidth

      if (previousShellWidth === null) return
      if (!leftPaneOpenRef.current) return
      if (previousShellWidth < RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH) return
      if (nextShellWidth >= RESOURCE_LIST_PANE_AUTO_COLLAPSE_WIDTH) return

      onPaneCollapseRef.current?.()
    })

    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      id={rootId}
      className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', rootClassName)}>
      <div id={contentId} className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <PageSidebar open={leftPaneOpen} onPaneCollapse={onPaneCollapse}>
          {pane}
        </PageSidebar>

        <div className="relative flex min-w-0 flex-1 flex-col">
          <motion.div
            ref={centerRef}
            id={centerId}
            layout
            transition={CHAT_SHELL_TRANSITION}
            className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', centerClassName)}>
            {topBar && <ErrorBoundary>{topBar}</ErrorBoundary>}
            {hasCenterContent ? (
              <ErrorBoundary>{centerContent}</ErrorBoundary>
            ) : (
              <>
                <ErrorBoundary>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{main}</div>
                </ErrorBoundary>
                {bottomComposer && <ErrorBoundary>{bottomComposer}</ErrorBoundary>}
              </>
            )}
            {centerOverlay && <ErrorBoundary>{centerOverlay}</ErrorBoundary>}
          </motion.div>
          {centerTopOverlay && <OverlayHost>{centerTopOverlay}</OverlayHost>}
        </div>

        <RightPaneHost open={paneOpen && panePosition === 'right'}>{pane}</RightPaneHost>
      </div>

      {sidePanel && (
        <div data-chat-side-panel-host className="pointer-events-none absolute inset-0 z-80 *:pointer-events-auto">
          <ErrorBoundary>{sidePanel}</ErrorBoundary>
        </div>
      )}

      <OverlayHost>{overlay}</OverlayHost>
    </div>
  )
}
