import { cn } from '@renderer/utils'
import { LayoutGroup, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

const COMPOSER_DOCK_TRANSITION = {
  duration: 0.28,
  ease: 'easeInOut'
} as const

export type ComposerDockPlacement = 'home' | 'docked'

interface ComposerDockTransitionFrameProps {
  placement: ComposerDockPlacement
  main: ReactNode
  composer: ReactNode
  mainVisible?: boolean
  overlay?: ReactNode
}

export default function ComposerDockTransitionFrame({
  placement,
  main,
  composer,
  mainVisible = placement === 'docked',
  overlay
}: ComposerDockTransitionFrameProps) {
  const composerRef = useRef<HTMLDivElement>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  const isDocked = placement === 'docked'

  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) return

    const updateHeight = () => setComposerHeight(node.getBoundingClientRect().height)
    updateHeight()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <LayoutGroup id="composer-dock-transition-frame">
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <motion.div
          className={cn('flex h-full min-h-0 flex-1 flex-col overflow-hidden', !mainVisible && 'pointer-events-none')}
          animate={{ opacity: mainVisible ? 1 : 0 }}
          initial={false}
          transition={COMPOSER_DOCK_TRANSITION}
          style={{ paddingBottom: isDocked && composer ? composerHeight : 0 }}>
          {main}
        </motion.div>

        <div
          className={cn(
            'absolute inset-x-0 z-10 w-full',
            isDocked ? 'bottom-0' : 'pointer-events-none top-0 bottom-0 flex items-center px-4 pb-[12vh]'
          )}>
          <motion.div
            layout="position"
            layoutId="composer-dock-transition-composer"
            className="pointer-events-auto w-full"
            transition={COMPOSER_DOCK_TRANSITION}>
            <div ref={composerRef} className="w-full">
              {composer}
            </div>
          </motion.div>
        </div>

        {overlay}
      </div>
    </LayoutGroup>
  )
}
