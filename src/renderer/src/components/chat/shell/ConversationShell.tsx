import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils'
import type { ReactNode, Ref } from 'react'

import { ChatAppShell } from './ChatAppShell'
import type { ChatPanePosition } from './types'

export interface ConversationShellProps {
  id?: string
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  center: ReactNode
  sidePanel?: ReactNode
  centerOverlay?: ReactNode
  overlay?: ReactNode
  rightPane?: ReactNode
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
}

export default function ConversationShell({
  id,
  className,
  pane,
  paneOpen,
  panePosition,
  topBar,
  center,
  sidePanel,
  centerOverlay,
  overlay,
  rightPane,
  centerId,
  centerRef,
  centerClassName
}: ConversationShellProps) {
  return (
    <div
      id={id}
      className={cn(
        'flex h-[calc(100vh-var(--navbar-height)-6px)] flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background',
        className
      )}>
      <QuickPanelProvider>
        <ChatAppShell
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          topBar={topBar}
          centerContent={center}
          sidePanel={sidePanel}
          centerOverlay={centerOverlay}
          overlay={overlay}
          centerId={centerId}
          centerRef={centerRef}
          centerClassName={centerClassName}
        />
      </QuickPanelProvider>
      {rightPane}
    </div>
  )
}
