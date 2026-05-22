import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import { ChatBottomOverlayInsetProvider, type ChatBottomOverlayInsets } from '../layout/ChatViewportInsetContext'

const COMPOSER_MESSAGE_GAP_PX = 16

export type ComposerDockPlacement = 'home' | 'docked'

interface ComposerDockTransitionFrameProps {
  placement: ComposerDockPlacement
  main: ReactNode
  composer: ReactNode
  mainVisible?: boolean
  /** Lift the composer above a full-area overlay (e.g. a maximized side pane). */
  composerElevated?: boolean
  overlay?: ReactNode
}

interface ComposerInlineInsets {
  left: number
  right: number
}

export default function ComposerDockTransitionFrame({
  placement,
  main,
  composer,
  mainVisible = placement === 'docked',
  composerElevated = false,
  overlay
}: ComposerDockTransitionFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const [bottomOverlayInsets, setBottomOverlayInsets] = useState<ChatBottomOverlayInsets | null>(null)
  const [composerInlineInsets, setComposerInlineInsets] = useState<ComposerInlineInsets>({ left: 0, right: 0 })
  const isDocked = placement === 'docked'

  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) return

    const updateInset = () => {
      if (!isDocked || !composer) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets({ left: 0, right: 0 })
        return
      }
      const inputbar = node.querySelector<HTMLElement>('[data-composer-inputbar]')
      const root = rootRef.current
      if (!inputbar || !root) {
        setBottomOverlayInsets(null)
        setComposerInlineInsets({ left: 0, right: 0 })
        return
      }
      const inputbarRect = inputbar.getBoundingClientRect()
      const composerRect = node.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const scroller = root.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
      const scrollerRect = scroller?.getBoundingClientRect()
      const scrollerClientWidth = scroller?.clientWidth ?? 0
      setBottomOverlayInsets({
        contentBottomPadding: Math.max(0, inputbarRect.bottom - composerRect.top + COMPOSER_MESSAGE_GAP_PX),
        scrollerBottomMargin: Math.max(0, rootRect.bottom - inputbarRect.bottom)
      })
      setComposerInlineInsets({
        left: scrollerRect ? Math.max(0, scrollerRect.left - rootRect.left) : 0,
        right: scrollerRect ? Math.max(0, rootRect.right - scrollerRect.left - scrollerClientWidth) : 0
      })
    }
    updateInset()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateInset)
    if (rootRef.current) observer.observe(rootRef.current)
    observer.observe(node)
    const inputbar = node.querySelector<HTMLElement>('[data-composer-inputbar]')
    if (inputbar) observer.observe(inputbar)
    const scroller = rootRef.current?.querySelector<HTMLElement>('[data-message-virtual-list-scroller]')
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [composer, isDocked])

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatBottomOverlayInsetProvider value={bottomOverlayInsets}>
        <div
          className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', !mainVisible && 'pointer-events-none')}
          style={{ opacity: mainVisible ? 1 : 0 }}>
          {main}
        </div>
      </ChatBottomOverlayInsetProvider>

      <div
        data-composer-dock-layer=""
        style={
          isDocked
            ? {
                paddingInlineStart: composerInlineInsets.left,
                paddingInlineEnd: composerInlineInsets.right
              }
            : undefined
        }
        className={cn(
          'absolute inset-x-0 w-full',
          composerElevated ? 'z-50' : 'z-10',
          isDocked ? 'bottom-0' : 'pointer-events-none top-0 bottom-0 flex items-center pb-[12vh]'
        )}>
        <div className="pointer-events-auto w-full">
          <div ref={composerRef} data-composer-dock-surface="" className="w-full">
            {composer}
          </div>
        </div>
      </div>

      {overlay}
    </div>
  )
}
