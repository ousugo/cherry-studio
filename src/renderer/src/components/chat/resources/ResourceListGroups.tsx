import { ContextMenu as UiContextMenu, ContextMenuTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps, CSSProperties, MouseEvent, Ref } from 'react'
import { useCallback, useState } from 'react'

import {
  type ResourceListGroup,
  type ResourceListItemBase,
  useResourceListActions,
  useResourceListGroupState,
  useResourceListMeta,
  useResourceListView
} from './ResourceListContext'

const GROUP_HEADER_COLOR_STYLE = {
  '--resource-list-group-color': 'var(--color-foreground)'
} as CSSProperties
const GROUP_HEADER_TEXT_CLASS = 'text-[color:var(--resource-list-group-color)]'
const EMPTY_GROUP_HEADER_ITEMS: ResourceListItemBase[] = []

type GroupHeaderProps = ComponentProps<'div'> & {
  group: ResourceListGroup
  ref?: Ref<HTMLDivElement>
}

export function GroupHeader({ group, className, ref, style, onContextMenu, ...props }: GroupHeaderProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const view = useResourceListView()
  const groupState = useResourceListGroupState(group.id)
  const viewGroup = view.groups.find((candidate) => candidate.group.id === group.id)
  const collapsed = groupState.collapsed
  const groupItems = viewGroup?.allItems ?? EMPTY_GROUP_HEADER_ITEMS
  const clickBehavior = meta.getGroupHeaderClickBehavior(group)
  const selected = clickBehavior === 'select-first-then-toggle' && groupState.selected
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const groupHeaderContext = { collapsed }
  const groupHeaderAction = meta.getGroupHeaderAction?.(group)
  const groupHeaderContextMenu = meta.getGroupHeaderContextMenu?.(group)
  const groupHeaderLeadingAction = meta.getGroupHeaderLeadingAction?.(group, groupHeaderContext)
  const customGroupHeaderIcon = meta.getGroupHeaderIcon?.(group, groupHeaderContext)
  const groupHeaderClassName = meta.getGroupHeaderClassName?.(group)
  const groupHeaderTooltip = meta.getGroupHeaderTooltip?.(group)
  const groupHeaderIcon =
    customGroupHeaderIcon === undefined ? (
      <ChevronDown size={14} className={cn('transition-transform', collapsed && '-rotate-90')} />
    ) : (
      customGroupHeaderIcon
    )
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      onContextMenu?.(event)
      if (event.defaultPrevented || !groupHeaderContextMenu) return

      setContextMenuOpen(true)
    },
    [groupHeaderContextMenu, onContextMenu]
  )
  const handleClick = useCallback(() => {
    if (clickBehavior === 'select-first-then-toggle' && !selected) {
      const firstItem = groupItems[0]
      if (firstItem) {
        actions.selectGroupHeaderItem(meta.getItemId(firstItem))
      }
      return
    }

    actions.toggleGroup(group.id)
  }, [actions, clickBehavior, group.id, groupItems, meta, selected])

  if (!group.label) return null
  const header = (
    <div
      ref={ref}
      style={{ ...GROUP_HEADER_COLOR_STYLE, ...style }}
      className={cn('group/resource-list-group h-8 w-full text-sm', GROUP_HEADER_TEXT_CLASS, className)}
      data-selected={selected || undefined}
      onContextMenu={handleContextMenu}
      {...props}>
      <div
        title={groupHeaderTooltip}
        className={cn(
          'flex w-full items-center gap-1.5 px-1.5',
          selected ? 'h-[30px] rounded-lg bg-accent text-foreground' : 'h-8',
          groupHeaderClassName
        )}>
        {groupHeaderLeadingAction && (
          <div className="flex size-5 shrink-0 items-center justify-center">{groupHeaderLeadingAction}</div>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none',
            GROUP_HEADER_TEXT_CLASS
          )}
          onClick={handleClick}>
          {groupHeaderIcon && (
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-lg text-inherit [&_svg]:stroke-current [&_svg]:text-inherit">
              {groupHeaderIcon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium text-[13px] text-inherit leading-5">
            {group.label}
          </span>
        </button>
        {groupHeaderAction && (
          <div className="pointer-events-none ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/resource-list-group:pointer-events-auto group-hover/resource-list-group:opacity-100">
            {groupHeaderAction}
          </div>
        )}
      </div>
    </div>
  )

  if (!groupHeaderContextMenu) {
    return header
  }

  return (
    <UiContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      {contextMenuOpen ? groupHeaderContextMenu : null}
    </UiContextMenu>
  )
}

type GroupShowMoreProps = ComponentProps<'div'> & {
  groupId: string
  ref?: Ref<HTMLDivElement>
}

export function GroupShowMore({ groupId, className, ref, style, ...props }: GroupShowMoreProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const groupState = useResourceListGroupState(groupId)
  const canCollapseToDefault = groupState.canCollapseToDefault
  const label = canCollapseToDefault ? meta.groupCollapseLabel : meta.groupShowMoreLabel

  if (!label) return null

  return (
    <div
      ref={ref}
      style={{ ...GROUP_HEADER_COLOR_STYLE, ...style }}
      className={cn('flex h-8 items-center justify-start pr-1.5 pl-8', className)}
      {...props}>
      <button
        type="button"
        className={cn(
          'flex h-5 min-w-0 items-center justify-start rounded-sm px-0 text-left font-medium text-[11px] leading-4 transition-colors duration-150',
          GROUP_HEADER_TEXT_CLASS,
          'hover:text-muted-foreground/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring'
        )}
        onClick={() => {
          if (canCollapseToDefault) {
            actions.collapseGroupItems(groupId)
            return
          }
          actions.showMoreInGroup(groupId)
        }}>
        {label}
      </button>
    </div>
  )
}
