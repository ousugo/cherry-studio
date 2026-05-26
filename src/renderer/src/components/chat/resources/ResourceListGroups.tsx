import { ContextMenu as UiContextMenu, ContextMenuTrigger } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps, MouseEvent, Ref } from 'react'
import { useCallback, useState } from 'react'

import {
  type ResourceListGroup,
  type ResourceListItemBase,
  type ResourceListSection,
  useResourceListActions,
  useResourceListGroupState,
  useResourceListMeta,
  useResourceListView
} from './ResourceListContext'
import {
  RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
  RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS,
  RESOURCE_LIST_ROW_HEIGHT_CLASS,
  RESOURCE_LIST_SELECTED_ROW_CLASS,
  RESOURCE_LIST_TEXT_START_PADDING_CLASS,
  RESOURCE_LIST_VISUAL_ROW_CLASS
} from './resourceListLayout'
import { ResourceListLeadingSlot } from './ResourceListLeadingSlot'

const EMPTY_GROUP_HEADER_ITEMS: ResourceListItemBase[] = []

type GroupHeaderProps = ComponentProps<'div'> & {
  group: ResourceListGroup
  ref?: Ref<HTMLDivElement>
}

type SectionHeaderProps = ComponentProps<'div'> & {
  section: ResourceListSection
  ref?: Ref<HTMLDivElement>
}

export function SectionHeader({ section, className, ref, style, ...props }: SectionHeaderProps) {
  const actions = useResourceListActions()
  const meta = useResourceListMeta()
  const sectionState = useResourceListGroupState(section.id)
  const collapsed = sectionState.collapsed
  const sectionHeaderAction = meta.getSectionHeaderAction?.(section)

  if (!section.label) return null

  return (
    <div
      ref={ref}
      style={style}
      className={cn(
        'group/resource-list-section flex w-full items-end px-0.5 pb-[2px]',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        className
      )}
      {...props}>
      <div className="flex h-9 w-full items-center gap-1 px-1.5 text-muted-foreground">
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:text-foreground"
          onClick={() => actions.toggleGroup(section.id)}>
          <span className="min-w-0 truncate text-left font-semibold text-[13px] text-inherit leading-5">
            {section.label}
          </span>
          <span
            aria-hidden="true"
            className="flex size-4 shrink-0 items-center justify-center rounded text-inherit opacity-0 transition-opacity duration-150 group-hover/resource-list-section:opacity-100 [&_svg]:stroke-current [&_svg]:text-inherit">
            <ChevronDown size={12} className={cn('transition-transform', collapsed && '-rotate-90')} />
          </span>
        </button>
        {sectionHeaderAction && (
          <div className="pointer-events-none ml-auto flex shrink-0 items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/resource-list-section:pointer-events-auto group-hover/resource-list-section:opacity-100">
            {sectionHeaderAction}
          </div>
        )}
      </div>
    </div>
  )
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
      style={style}
      className={cn(
        'group/resource-list-group flex w-full items-center text-foreground text-sm',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        className
      )}
      data-selected={selected || undefined}
      onContextMenu={handleContextMenu}
      {...props}>
      <div
        title={groupHeaderTooltip}
        className={cn(
          'flex w-full items-center gap-1.5 px-1.5 transition-colors duration-150',
          RESOURCE_LIST_VISUAL_ROW_CLASS,
          RESOURCE_LIST_INTERACTIVE_ROW_CLASS,
          selected && RESOURCE_LIST_SELECTED_ROW_CLASS,
          groupHeaderClassName
        )}>
        {groupHeaderLeadingAction && (
          <div className={RESOURCE_LIST_LEADING_ACTION_SLOT_CLASS}>{groupHeaderLeadingAction}</div>
        )}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-current={selected ? 'true' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-inherit outline-none"
          onClick={handleClick}>
          <ResourceListLeadingSlot aria-hidden="true" variant="groupHeader">
            {groupHeaderIcon}
          </ResourceListLeadingSlot>
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
      style={style}
      className={cn(
        'flex items-center justify-start pr-1.5 text-foreground',
        RESOURCE_LIST_ROW_HEIGHT_CLASS,
        RESOURCE_LIST_TEXT_START_PADDING_CLASS,
        className
      )}
      {...props}>
      <button
        type="button"
        className="flex h-5 min-w-0 items-center justify-start rounded-sm px-0 text-left font-medium text-[11px] text-inherit leading-4 transition-colors duration-150 hover:text-muted-foreground/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
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
