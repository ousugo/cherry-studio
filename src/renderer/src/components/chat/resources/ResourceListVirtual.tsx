import {
  buildGroupedVirtualRows,
  type DynamicVirtualListRef,
  GroupedSortableVirtualList,
  type GroupedSortableVirtualListDragPayload,
  GroupedVirtualList,
  type GroupedVirtualListGroup
} from '@renderer/components/VirtualList'
import { cn } from '@renderer/utils/style'
import type { ReactNode, Ref, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  type ResourceListContextValue,
  type ResourceListGroup,
  type ResourceListItemBase,
  useResourceList
} from './ResourceListContext'
import { GroupHeader, GroupShowMore } from './ResourceListGroups'

const SCROLLBAR_AUTO_HIDE_DELAY = 1200
const SCROLLBAR_FADE_STEP = 140
const ITEM_ROW_GAP_CLASS = 'pb-[2px]'

type ScrollbarStage = 'active' | 'fade-1' | 'fade-2' | 'fade-3' | 'idle'

const SCROLLBAR_THUMB_CLASS_BY_STAGE: Record<ScrollbarStage, string> = {
  active:
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--color-scrollbar-thumb)_0%,var(--color-scrollbar-thumb)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_55%,transparent)_72%,transparent_100%)]',
  'fade-1':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_70%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_35%,transparent)_72%,transparent_100%)]',
  'fade-2':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_40%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_20%,transparent)_72%,transparent_100%)]',
  'fade-3':
    '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_0%,color-mix(in_srgb,var(--color-scrollbar-thumb)_16%,transparent)_45%,color-mix(in_srgb,var(--color-scrollbar-thumb)_8%,transparent)_72%,transparent_100%)]',
  idle: '[&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,transparent_0%,transparent_50%,transparent_100%)]'
}

const SCROLLBAR_COLOR_BY_STAGE: Record<ScrollbarStage, string> = {
  active: 'var(--color-scrollbar-thumb) transparent',
  'fade-1': 'color-mix(in srgb, var(--color-scrollbar-thumb) 70%, transparent) transparent',
  'fade-2': 'color-mix(in srgb, var(--color-scrollbar-thumb) 40%, transparent) transparent',
  'fade-3': 'color-mix(in srgb, var(--color-scrollbar-thumb) 16%, transparent) transparent',
  idle: 'transparent transparent'
}

export type VirtualItemsProps<T extends ResourceListItemBase> = {
  className?: string
  ref?: Ref<HTMLDivElement>
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
}

type ResourceListVirtualItem<T extends ResourceListItemBase> = {
  item: T
  itemIndex: number
}

type ResourceListVirtualFooter = {
  groupId: string
}

type ResourceListVirtualGroup<T extends ResourceListItemBase> = GroupedVirtualListGroup<
  ResourceListGroup,
  ResourceListVirtualItem<T>,
  ResourceListGroup,
  ResourceListVirtualFooter
>

const estimateResourceListGroupHeaderSize = () => 32
const estimateResourceListGroupFooterSize = () => 32

function useAutoHideScrollbar(delay = SCROLLBAR_AUTO_HIDE_DELAY) {
  const [stage, setStage] = useState<ScrollbarStage>('idle')
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearScrollingTimeout = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout)
    timeoutRefs.current = []
  }, [])

  const handleScroll = useCallback(() => {
    clearScrollingTimeout()
    setStage('active')
    timeoutRefs.current = [
      setTimeout(() => setStage('fade-1'), delay),
      setTimeout(() => setStage('fade-2'), delay + SCROLLBAR_FADE_STEP),
      setTimeout(() => setStage('fade-3'), delay + SCROLLBAR_FADE_STEP * 2),
      setTimeout(() => setStage('idle'), delay + SCROLLBAR_FADE_STEP * 3)
    ]
  }, [clearScrollingTimeout, delay])

  useEffect(() => clearScrollingTimeout, [clearScrollingTimeout])

  return { stage, handleScroll }
}

function getListViewportClassName(stage: ScrollbarStage, className?: string) {
  return cn(
    'min-h-0 flex-1 overflow-auto px-1.5 py-1.5 pt-0 [scrollbar-gutter:stable]',
    '[&::-webkit-scrollbar-thumb:hover]:bg-[var(--color-scrollbar-thumb-hover)]',
    '[&::-webkit-scrollbar-thumb]:transition-[background] [&::-webkit-scrollbar-thumb]:duration-150 [&::-webkit-scrollbar-thumb]:ease-out',
    SCROLLBAR_THUMB_CLASS_BY_STAGE[stage],
    className
  )
}

function VirtualItemRow({ children }: { children: ReactNode }) {
  return (
    <div data-resource-list-item-row="true" className={ITEM_ROW_GAP_CLASS}>
      {children}
    </div>
  )
}

function buildVirtualGroups<T extends ResourceListItemBase>(
  context: ResourceListContextValue<T>
): ResourceListVirtualGroup<T>[] {
  const groups: ResourceListVirtualGroup<T>[] = []
  let itemIndex = 0

  for (const group of context.view.groups) {
    const items: ResourceListVirtualItem<T>[] = []

    for (const item of group.items) {
      items.push({ item, itemIndex })
      itemIndex += 1
    }

    groups.push({
      group: group.group,
      header: group.group.label ? group.group : undefined,
      items,
      footer: group.hasMore || group.canCollapseToDefault ? { groupId: group.group.id } : undefined
    })
  }

  return groups
}

function getRevealRowIndex<T extends ResourceListItemBase>(
  groups: ResourceListVirtualGroup<T>[],
  itemId: string,
  getItemId: (item: T) => string
) {
  const rows = buildGroupedVirtualRows(groups, true, true)
  return rows.findIndex((row) => row.type === 'item' && getItemId(row.item.item) === itemId)
}

function useRevealRequestScroll<T extends ResourceListItemBase>(
  context: ResourceListContextValue<T>,
  groups: ResourceListVirtualGroup<T>[],
  virtualListRef: RefObject<DynamicVirtualListRef | null>
) {
  const scrolledRequestRef = useRef<string | null>(null)
  const revealRequest = context.meta.revealRequest

  useEffect(() => {
    if (!revealRequest) return

    const requestKey = `${revealRequest.requestId}:${revealRequest.itemId}`
    if (scrolledRequestRef.current === requestKey) return

    const rowIndex = getRevealRowIndex(groups, revealRequest.itemId, context.meta.getItemId)
    if (rowIndex < 0) return

    scrolledRequestRef.current = requestKey
    virtualListRef.current?.scrollToIndex(rowIndex, { align: 'center' })
  }, [context.meta.getItemId, groups, revealRequest, virtualListRef])
}

export function VirtualItems<T extends ResourceListItemBase>({ className, ref, renderItem }: VirtualItemsProps<T>) {
  const context = useResourceList<T>()
  const groups = useMemo(() => buildVirtualGroups(context), [context])
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const { stage, handleScroll } = useAutoHideScrollbar()
  const isScrolling = stage !== 'idle'
  const estimateVirtualItemSize = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => context.meta.estimateItemSize(virtualItem.itemIndex),
    [context.meta]
  )
  const renderGroupHeader = useCallback((group: ResourceListGroup) => <GroupHeader group={group} />, [])
  const renderVirtualItem = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => (
      <VirtualItemRow>{renderItem(virtualItem.item, context)}</VirtualItemRow>
    ),
    [context, renderItem]
  )
  const renderGroupFooter = useCallback(
    (footer: ResourceListVirtualFooter) => <GroupShowMore groupId={footer.groupId} />,
    []
  )
  useRevealRequestScroll(context, groups, virtualListRef)

  return (
    <GroupedVirtualList
      ref={virtualListRef}
      scrollElementRef={ref}
      role="listbox"
      groups={groups}
      className={getListViewportClassName(stage, className)}
      scrollerProps={{ 'data-scrolling': isScrolling ? 'true' : 'false' }}
      scrollerStyle={{ scrollbarColor: SCROLLBAR_COLOR_BY_STAGE[stage] }}
      onScroll={handleScroll}
      overscan={6}
      estimateGroupHeaderSize={estimateResourceListGroupHeaderSize}
      estimateItemSize={estimateVirtualItemSize}
      estimateGroupFooterSize={estimateResourceListGroupFooterSize}
      renderGroupHeader={renderGroupHeader}
      renderItem={renderVirtualItem}
      renderGroupFooter={renderGroupFooter}
    />
  )
}

export type VirtualDraggableItemsProps<T extends ResourceListItemBase> = {
  className?: string
  renderItem: (item: T, context: ResourceListContextValue<T>) => ReactNode
  ref?: Ref<HTMLDivElement>
}

export function VirtualDraggableItems<T extends ResourceListItemBase>({
  className,
  ref,
  renderItem
}: VirtualDraggableItemsProps<T>) {
  const context = useResourceList<T>()
  const groups = useMemo(() => buildVirtualGroups(context), [context])
  const virtualListRef = useRef<DynamicVirtualListRef>(null)
  const { stage, handleScroll } = useAutoHideScrollbar()
  const isScrolling = stage !== 'idle'
  const getGroupId = useCallback((group: ResourceListGroup) => group.id, [])
  const getVirtualItemId = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => context.meta.getItemId(virtualItem.item),
    [context.meta]
  )
  const estimateVirtualItemSize = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => context.meta.estimateItemSize(virtualItem.itemIndex),
    [context.meta]
  )
  const handleGroupedDragEnd = useCallback(
    (payload: GroupedSortableVirtualListDragPayload<ResourceListGroup, ResourceListVirtualItem<T>>) => {
      if (payload.type === 'group') {
        context.actions.reorder({
          type: 'group',
          activeGroupId: String(payload.activeGroupId),
          overGroupId: String(payload.overGroupId),
          overType: payload.overType,
          sourceIndex: payload.sourceIndex,
          targetIndex: payload.targetIndex
        })
        return
      }

      if (payload.overType === 'item' && payload.activeId === payload.overId) return
      context.actions.reorder({
        type: 'item',
        activeId: String(payload.activeId),
        overId: String(payload.overId),
        position: payload.position,
        overType: payload.overType,
        sourceGroupId: String(payload.sourceGroupId),
        targetGroupId: String(payload.targetGroupId),
        sourceIndex: payload.sourceIndex,
        targetIndex: payload.targetIndex
      })
    },
    [context.actions]
  )
  const canDragGroup = useCallback(
    (group: ResourceListGroup, groupIndex: number) => context.meta.canDragGroup?.(group, groupIndex) ?? true,
    [context.meta]
  )
  const canDragVirtualItem = useCallback(
    (
      virtualItem: ResourceListVirtualItem<T>,
      _itemIndex: number,
      group: ResourceListGroup,
      groupIndex: number,
      itemIndexInGroup: number
    ) =>
      context.meta.canDragItem?.({
        item: virtualItem.item,
        itemIndex: virtualItem.itemIndex,
        group,
        groupIndex,
        itemIndexInGroup
      }) ?? true,
    [context.meta]
  )
  const canDropGroup = useCallback(
    (payload: {
      activeGroupId: string | number
      overGroupId: string | number
      overType: 'group' | 'item'
      sourceIndex?: number
      targetIndex?: number
    }) =>
      context.meta.canDropGroup?.({
        activeGroupId: String(payload.activeGroupId),
        overGroupId: String(payload.overGroupId),
        overType: payload.overType,
        sourceIndex: payload.sourceIndex ?? -1,
        targetIndex: payload.targetIndex ?? -1
      }) ?? true,
    [context.meta]
  )
  const canDropVirtualItem = useCallback(
    (payload: {
      activeId: string | number
      activeItem: ResourceListVirtualItem<T>
      overGroup: ResourceListGroup
      overGroupId: string | number
      overId: string | number
      overItem?: ResourceListVirtualItem<T>
      overType: 'group' | 'item'
      sourceGroup: ResourceListGroup
      sourceGroupId: string | number
      sourceIndex: number
      targetIndex: number
    }) =>
      context.meta.canDropItem?.({
        activeId: String(payload.activeId),
        activeItem: payload.activeItem.item,
        overId: String(payload.overId),
        overItem: payload.overItem?.item,
        overType: payload.overType,
        sourceGroup: payload.sourceGroup,
        sourceGroupId: String(payload.sourceGroupId),
        sourceIndex: payload.sourceIndex,
        targetGroup: payload.overGroup,
        targetGroupId: String(payload.overGroupId),
        targetIndex: payload.targetIndex
      }) ?? true,
    [context.meta]
  )
  const renderGroupHeader = useCallback((group: ResourceListGroup) => <GroupHeader group={group} />, [])
  const renderVirtualItem = useCallback(
    (virtualItem: ResourceListVirtualItem<T>) => (
      <VirtualItemRow>{renderItem(virtualItem.item, context)}</VirtualItemRow>
    ),
    [context, renderItem]
  )
  const renderGroupFooter = useCallback(
    (footer: ResourceListVirtualFooter) => <GroupShowMore groupId={footer.groupId} />,
    []
  )
  useRevealRequestScroll(context, groups, virtualListRef)

  return (
    <GroupedSortableVirtualList
      ref={virtualListRef}
      scrollElementRef={ref}
      role="listbox"
      groups={groups}
      className={getListViewportClassName(stage, className)}
      scrollerProps={{ 'data-scrolling': isScrolling ? 'true' : 'false' }}
      scrollerStyle={{ scrollbarColor: SCROLLBAR_COLOR_BY_STAGE[stage] }}
      onScroll={handleScroll}
      overscan={6}
      getGroupId={getGroupId}
      getItemId={getVirtualItemId}
      dragCapabilities={context.meta.dragCapabilities}
      estimateGroupHeaderSize={estimateResourceListGroupHeaderSize}
      estimateItemSize={estimateVirtualItemSize}
      estimateGroupFooterSize={estimateResourceListGroupFooterSize}
      canDragGroup={canDragGroup}
      canDragItem={canDragVirtualItem}
      canDropGroup={canDropGroup}
      canDropItem={canDropVirtualItem}
      onDragEnd={handleGroupedDragEnd}
      renderGroupHeader={renderGroupHeader}
      renderItem={renderVirtualItem}
      renderGroupFooter={renderGroupFooter}
    />
  )
}
