import { Drawer, DrawerContent, DrawerTitle } from '@cherrystudio/ui'
import { isMac } from '@renderer/config/constant'
import { useTimer } from '@renderer/hooks/useTimer'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type SidePanelDrawerClose = () => void

interface SidePanelDrawerProps {
  children: ReactNode | ((onClose: SidePanelDrawerClose) => ReactNode)
  onCloseReady?: (onClose: SidePanelDrawerClose) => void
  resolve: () => void
  title: ReactNode
}

const CLOSE_ANIMATION_MS = 300

const SidePanelDrawer = ({ children, onCloseReady, resolve, title }: SidePanelDrawerProps) => {
  const [open, setOpen] = useState(true)
  const closingRef = useRef(false)
  const { setTimeoutTimer } = useTimer()

  const onClose = useCallback(() => {
    if (closingRef.current) return

    closingRef.current = true
    setOpen(false)
    setTimeoutTimer('onClose', resolve, CLOSE_ANIMATION_MS)
  }, [resolve, setTimeoutTimer])

  useEffect(() => {
    onCloseReady?.(onClose)
  }, [onClose, onCloseReady])

  return (
    <Drawer direction="left" open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DrawerContent className="!w-(--assistants-width) !max-w-none sm:!max-w-none h-screen! overflow-hidden rounded-none border-border border-r bg-card p-0 shadow-xl">
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <div className={cn('flex h-full min-h-0 overflow-hidden bg-card', isMac && 'pt-(--navbar-height)')}>
          {typeof children === 'function' ? children(onClose) : children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default SidePanelDrawer
