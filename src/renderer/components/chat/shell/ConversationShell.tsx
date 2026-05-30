import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { cn } from '@renderer/utils'
import type { PropsWithChildren, ReactNode, Ref } from 'react'

import { useOptionalShellState } from '../panes/Shell'
import { ChatAppShell } from './ChatAppShell'
import type { ChatPanePosition } from './types'

export interface ConversationShellProps {
  id?: string
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  topRightTool?: ReactNode
  center: ReactNode
  sidePanel?: ReactNode
  centerOverlay?: ReactNode
  /** Overlay scoped to the center area but rendered above the center's transform/stacking layer. */
  centerTopOverlay?: ReactNode
  overlay?: ReactNode
  rightPane?: ReactNode
  centerId?: string
  centerRef?: Ref<HTMLDivElement>
  centerClassName?: string
  onPaneCollapse?: () => void
}

export default function ConversationShell({
  id,
  className,
  pane,
  paneOpen,
  panePosition,
  topBar,
  topRightTool,
  center,
  sidePanel,
  centerOverlay,
  centerTopOverlay,
  overlay,
  rightPane,
  centerId,
  centerRef,
  centerClassName,
  onPaneCollapse
}: ConversationShellProps) {
  const resolvedTopBar = topRightTool ? <ConversationShellTopBar>{topBar}</ConversationShellTopBar> : topBar
  return (
    <div
      id={id}
      className={cn(
        'relative flex h-[calc(100vh-var(--navbar-height)-6px)] flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background',
        className
      )}>
      <QuickPanelProvider>
        <ChatAppShell
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          topBar={resolvedTopBar}
          centerContent={center}
          sidePanel={sidePanel}
          centerOverlay={centerOverlay}
          centerTopOverlay={centerTopOverlay}
          overlay={overlay}
          centerId={centerId}
          centerRef={centerRef}
          centerClassName={centerClassName}
          onPaneCollapse={onPaneCollapse}
        />
      </QuickPanelProvider>
      {topRightTool && <ConversationShellTopRightTool>{topRightTool}</ConversationShellTopRightTool>}
      {rightPane}
    </div>
  )
}

const ConversationShellTopBar = ({ children }: PropsWithChildren) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  return <div className={cn('flex h-fit w-full min-w-0', !maximized && 'pr-11')}>{children}</div>
}

const ConversationShellTopRightTool = ({ children }: PropsWithChildren) => {
  const shellState = useOptionalShellState()
  const maximized = shellState?.maximized ?? false
  if (maximized) return null
  return (
    <div className="absolute top-0 right-2 z-20 flex h-(--navbar-height) w-7.5 items-center justify-center [-webkit-app-region:no-drag]">
      {children}
    </div>
  )
}
