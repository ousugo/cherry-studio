import { cn } from '@renderer/utils/style'
import { Fragment, useMemo, useState } from 'react'

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '../primitives'
import { ActionConfirmDialog } from './ActionConfirmDialog'
import type { ResolvedAction } from './actionTypes'

const ACTION_MENU_CONTENT_CLASS = cn(
  'z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem]',
  'origin-(--radix-context-menu-content-transform-origin) overflow-y-auto overflow-x-hidden',
  'rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
)
const ACTION_MENU_ITEM_CLASS = cn(
  'gap-2 rounded-sm px-2 py-1.5 text-sm focus:bg-accent focus:text-accent-foreground',
  'data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  "[&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground"
)
const ACTION_MENU_SUB_TRIGGER_CLASS = cn(
  ACTION_MENU_ITEM_CLASS,
  'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
)
const ACTION_MENU_SEPARATOR_CLASS = '-mx-1 my-1 h-px bg-border'

export interface ActionMenuProps<TContext = unknown> {
  actions: readonly ResolvedAction<TContext>[]
  className?: string
  confirmDialogContentClassName?: string
  confirmDialogOverlayClassName?: string
  onAction: (action: ResolvedAction<TContext>) => void | Promise<void>
  onConfirmActionComplete?: () => void
}

function groupActions<TContext>(actions: readonly ResolvedAction<TContext>[]) {
  const grouped: Array<{ action: ResolvedAction<TContext>; separatorBefore: boolean }> = []
  let previousGroup: string | undefined

  for (const action of actions) {
    grouped.push({
      action,
      separatorBefore: grouped.length > 0 && action.group !== previousGroup
    })
    previousGroup = action.group
  }

  return grouped
}

export function ActionMenu<TContext = unknown>({
  actions,
  className,
  confirmDialogContentClassName,
  confirmDialogOverlayClassName,
  onAction,
  onConfirmActionComplete
}: ActionMenuProps<TContext>) {
  const groupedActions = useMemo(() => groupActions(actions), [actions])
  const [pendingAction, setPendingAction] = useState<ResolvedAction<TContext> | undefined>()

  const runAction = async (action: ResolvedAction<TContext>) => {
    if (!action.availability.enabled) return
    await onAction(action)
  }

  const renderAction = (action: ResolvedAction<TContext>) => {
    const disabled = !action.availability.enabled
    const content = (
      <>
        {action.icon}
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
        {action.shortcut && <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>}
      </>
    )

    if (action.children.length > 0) {
      return (
        <ContextMenuSub key={action.id}>
          <ContextMenuSubTrigger disabled={disabled} className={ACTION_MENU_SUB_TRIGGER_CLASS}>
            {content}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={ACTION_MENU_CONTENT_CLASS}>
            {action.children.map(renderAction)}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )
    }

    return (
      <ContextMenuItem
        key={action.id}
        disabled={disabled}
        variant={action.danger ? 'destructive' : 'default'}
        className={ACTION_MENU_ITEM_CLASS}
        onSelect={(event) => {
          if (action.confirm) {
            event.preventDefault()
            setPendingAction(action)
            return
          }
          void runAction(action)
        }}>
        {content}
      </ContextMenuItem>
    )
  }

  return (
    <>
      <ContextMenuContent className={cn(ACTION_MENU_CONTENT_CLASS, className)}>
        {groupedActions.map(({ action, separatorBefore }) => (
          <Fragment key={action.id}>
            {separatorBefore && <ContextMenuSeparator className={ACTION_MENU_SEPARATOR_CLASS} />}
            {renderAction(action)}
          </Fragment>
        ))}
      </ContextMenuContent>
      <ActionConfirmDialog
        open={!!pendingAction}
        confirm={pendingAction?.confirm}
        contentClassName={confirmDialogContentClassName}
        overlayClassName={confirmDialogOverlayClassName}
        onOpenChange={(open) => {
          if (!open) setPendingAction(undefined)
        }}
        onConfirm={async () => {
          if (!pendingAction) return
          await runAction(pendingAction)
          setPendingAction(undefined)
          onConfirmActionComplete?.()
        }}
      />
    </>
  )
}
