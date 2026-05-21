import { cn } from '@renderer/utils'
import { LayoutGroup, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

import { ChatBottomOverlayInsetProvider, type ChatBottomOverlayInsets } from '../layout/ChatViewportInsetContext'

const COMPOSER_DOCK_TRANSITION = {
  duration: 0.28,
  ease: 'easeInOut'
} as const
const COMPOSER_MESSAGE_GAP_PX = 16

export type ComposerDockPlacement = 'home' | 'docked'

interface ComposerDockTransitionFrameProps {
  placement: ComposerDockPlacement
  main: ReactNode
  composer: ReactNode
  mainVisible?: boolean
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
    <LayoutGroup id="composer-dock-transition-frame">
      <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ChatBottomOverlayInsetProvider value={bottomOverlayInsets}>
          <motion.div
            className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', !mainVisible && 'pointer-events-none')}
            animate={{ opacity: mainVisible ? 1 : 0 }}
            initial={false}
            transition={COMPOSER_DOCK_TRANSITION}>
            {main}
          </motion.div>
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
            'absolute inset-x-0 z-10 w-full',
            isDocked ? 'bottom-0' : 'pointer-events-none top-0 bottom-0 flex items-center pb-[12vh]'
          )}>
          <motion.div
            layout="position"
            layoutId="composer-dock-transition-composer"
            className="pointer-events-auto w-full"
            transition={COMPOSER_DOCK_TRANSITION}>
            <div ref={composerRef} data-composer-dock-surface="" className="w-full">
              {composer}
            </div>
          </motion.div>
        </div>

        {overlay}
      </div>
    </LayoutGroup>
  )
}
