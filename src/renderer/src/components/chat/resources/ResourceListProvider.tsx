import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

import {
  ResourceListContext,
  type ResourceListContextValue,
  type ResourceListDragCapabilities,
  type ResourceListFilterOption,
  type ResourceListGroup,
  type ResourceListGroupHeaderClickBehavior,
  type ResourceListItemBase,
  type ResourceListMeta,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSortOption,
  type ResourceListState,
  type ResourceListStatus,
  type ResourceListVariantContext,
  type ResourceListViewGroup
} from './ResourceListContext'

const EMPTY_SORT_OPTIONS: ResourceListSortOption<ResourceListItemBase>[] = []
const EMPTY_FILTER_OPTIONS: ResourceListFilterOption<ResourceListItemBase>[] = []
const getDefaultItemId = (item: ResourceListItemBase) => item.id
const getDefaultItemLabel = (item: ResourceListItemBase) => item.name
const estimateDefaultItemSize = () => 34
const UNGROUPED_RESOURCE_GROUP: ResourceListGroup = { id: 'ungrouped', label: '' }

type ResourceListGroupHeaderClickBehaviorResolver =
  | ResourceListGroupHeaderClickBehavior
  | ((group: ResourceListGroup) => ResourceListGroupHeaderClickBehavior)

type DeriveResourceListItemsOptions<T extends ResourceListItemBase> = {
  filterById: ReadonlyMap<string, ResourceListFilterOption<T>>
  filters: readonly string[]
  getItemLabel: (item: T) => string
  items: readonly T[]
  query: string
  sortById: ReadonlyMap<string, ResourceListSortOption<T>>
  sortId: string | null
}

type BuildResourceListGroupsOptions<T extends ResourceListItemBase> = {
  collapsedGroupIds: readonly string[]
  defaultGroupVisibleCount: number
  groupBy?: (item: T) => ResourceListGroup | null
  groupVisibleCounts: Record<string, number>
  items: readonly T[]
}

type FindRevealTargetOptions<T extends ResourceListItemBase> = {
  defaultGroupVisibleCount: number
  getItemId: (item: T) => string
  groupBy?: (item: T) => ResourceListGroup | null
  groupVisibleCounts: Record<string, number>
  itemId: string
  items: readonly T[]
}

function getResourceListGroup<T extends ResourceListItemBase>(
  item: T,
  groupBy?: (item: T) => ResourceListGroup | null
) {
  return groupBy?.(item) ?? UNGROUPED_RESOURCE_GROUP
}

function deriveResourceListItems<T extends ResourceListItemBase>({
  filterById,
  filters,
  getItemLabel,
  items,
  query,
  sortById,
  sortId
}: DeriveResourceListItemsOptions<T>) {
  const normalizedQuery = query.trim().toLowerCase()
  let next = [...items]

  if (normalizedQuery) {
    next = next.filter((item) => getItemLabel(item).toLowerCase().includes(normalizedQuery))
  }

  if (filters.length > 0) {
    next = next.filter((item) => {
      for (const filterId of filters) {
        const filter = filterById.get(filterId)
        if (filter && !filter.predicate(item)) return false
      }
      return true
    })
  }

  const sort = sortId ? sortById.get(sortId) : null
  if (sort) {
    next.sort(sort.comparator)
  }

  return next
}

function buildResourceListGroups<T extends ResourceListItemBase>({
  collapsedGroupIds,
  defaultGroupVisibleCount,
  groupBy,
  groupVisibleCounts,
  items
}: BuildResourceListGroupsOptions<T>): ResourceListViewGroup<T>[] {
  const collapsedGroups = new Set(collapsedGroupIds)

  if (!groupBy) {
    const group = { id: 'all', label: '' }
    return [
      {
        group,
        allItems: [...items],
        items: [...items],
        totalCount: items.length,
        visibleCount: items.length,
        hasMore: false,
        canCollapseToDefault: false,
        collapsed: false
      }
    ]
  }

  const groups = new Map<string, { group: ResourceListGroup; items: T[] }>()
  for (const item of items) {
    const group = getResourceListGroup(item, groupBy)
    const existing = groups.get(group.id)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(group.id, { group, items: [item] })
    }
  }

  return [...groups.values()].map(({ group, items }) => {
    const totalCount = items.length
    const collapsed = collapsedGroups.has(group.id)
    const configuredVisibleCount = groupVisibleCounts[group.id] ?? defaultGroupVisibleCount
    const visibleCount = Math.min(configuredVisibleCount, totalCount)
    const hasMore = !collapsed && visibleCount < totalCount
    const canCollapseToDefault = !collapsed && totalCount > defaultGroupVisibleCount && visibleCount >= totalCount

    return {
      group: { ...group, count: group.count ?? totalCount },
      allItems: items,
      items: collapsed ? [] : items.slice(0, visibleCount),
      totalCount,
      visibleCount: collapsed ? 0 : visibleCount,
      hasMore,
      canCollapseToDefault,
      collapsed
    }
  })
}

function findResourceListRevealTarget<T extends ResourceListItemBase>({
  defaultGroupVisibleCount,
  getItemId,
  groupBy,
  groupVisibleCounts,
  itemId,
  items
}: FindRevealTargetOptions<T>) {
  const targetItem = items.find((item) => getItemId(item) === itemId)
  if (!targetItem) return null

  if (!groupBy) {
    return { targetGroupId: null, visibleCount: undefined }
  }

  const targetGroupId = getResourceListGroup(targetItem, groupBy).id
  const groupItems = items.filter((item) => getResourceListGroup(item, groupBy).id === targetGroupId)
  const targetIndexInGroup = groupItems.findIndex((item) => getItemId(item) === itemId)
  const currentVisibleCount = groupVisibleCounts[targetGroupId] ?? defaultGroupVisibleCount
  const targetVisibleCount = targetIndexInGroup + 1
  const visibleCount =
    targetIndexInGroup >= 0 && targetVisibleCount > currentVisibleCount ? targetVisibleCount : undefined

  return { targetGroupId, visibleCount }
}

export type ResourceListProviderProps<T extends ResourceListItemBase> = {
  items: readonly T[]
  children: ReactNode
  variant?: ResourceListVariantContext['variant']
  status?: ResourceListStatus
  selectedId?: string | null
  defaultSortId?: string
  sortOptions?: ResourceListSortOption<T>[]
  filterOptions?: ResourceListFilterOption<T>[]
  groupBy?: (item: T) => ResourceListGroup | null
  getItemId?: (item: T) => string
  getItemLabel?: (item: T) => string
  getGroupHeaderAction?: (group: ResourceListGroup) => ReactNode
  getGroupHeaderContextMenu?: ResourceListMeta<T>['getGroupHeaderContextMenu']
  getGroupHeaderLeadingAction?: ResourceListMeta<T>['getGroupHeaderLeadingAction']
  getGroupHeaderIcon?: ResourceListMeta<T>['getGroupHeaderIcon']
  getGroupHeaderClassName?: ResourceListMeta<T>['getGroupHeaderClassName']
  getGroupHeaderTooltip?: ResourceListMeta<T>['getGroupHeaderTooltip']
  groupHeaderClickBehavior?: ResourceListGroupHeaderClickBehaviorResolver
  collapsedGroupIds?: readonly string[]
  revealRequest?: ResourceListRevealRequest
  dragCapabilities?: ResourceListDragCapabilities
  canDragGroup?: (group: ResourceListGroup, groupIndex: number) => boolean
  canDragItem?: (args: {
    item: T
    itemIndex: number
    group: ResourceListGroup
    groupIndex: number
    itemIndexInGroup: number
  }) => boolean
  canDropGroup?: (args: {
    activeGroupId: string
    overGroupId: string
    overType: 'group' | 'item'
    sourceIndex: number
    targetIndex: number
  }) => boolean
  canDropItem?: (args: {
    activeId: string
    activeItem: T
    overId: string
    overItem?: T
    overType: 'group' | 'item'
    sourceGroup: ResourceListGroup
    sourceGroupId: string
    sourceIndex: number
    targetGroup: ResourceListGroup
    targetGroupId: string
    targetIndex: number
  }) => boolean
  defaultGroupVisibleCount?: number
  groupLoadStep?: number
  groupShowMoreLabel?: string
  groupCollapseLabel?: string
  estimateItemSize?: (index: number) => number
  onSelectItem?: (id: string) => void
  onRenameItem?: (id: string, name: string) => void
  onGroupHeaderSelectItem?: (id: string) => void
  onOpenContextMenu?: (id: string) => void
  onReorder?: (payload: ResourceListReorderPayload) => void
  onCollapsedGroupIdsChange?: (groupIds: string[]) => void
}

type ProviderAction =
  | { type: 'setQuery'; query: string }
  | { type: 'setFilters'; filters: string[] }
  | { type: 'toggleFilter'; filterId: string }
  | { type: 'setSort'; sort: string | null }
  | { type: 'selectItem'; id: string | null }
  | { type: 'hoverItem'; id: string | null }
  | { type: 'startRename'; id: string }
  | { type: 'cancelRename' }
  | { type: 'showMoreInGroup'; groupId: string }
  | { type: 'collapseGroupItems'; groupId: string; defaultCount: number }
  | { type: 'toggleGroup'; groupId: string }
  | {
      type: 'revealItem'
      clearFilters?: boolean
      clearQuery?: boolean
      groupId: string | null
      itemId: string
      requestId: number
      visibleCount?: number
    }
  | { type: 'clearRevealFocus'; itemId: string; requestId: number }
  | { type: 'startDrag'; id: string }
  | { type: 'endDrag' }
  | { type: 'setStatus'; status: ResourceListStatus }

function reducer(state: ResourceListState, action: ProviderAction): ResourceListState {
  switch (action.type) {
    case 'setQuery':
      return { ...state, query: action.query }
    case 'setFilters':
      return { ...state, filters: action.filters }
    case 'toggleFilter': {
      const next = new Set(state.filters)
      if (next.has(action.filterId)) {
        next.delete(action.filterId)
      } else {
        next.add(action.filterId)
      }
      return { ...state, filters: [...next] }
    }
    case 'setSort':
      return { ...state, sort: action.sort }
    case 'selectItem':
      return { ...state, selectedId: action.id }
    case 'hoverItem':
      return { ...state, hoveredId: action.id }
    case 'startRename':
      return { ...state, renamingId: action.id }
    case 'cancelRename':
      return { ...state, renamingId: null }
    case 'showMoreInGroup': {
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: Number.POSITIVE_INFINITY
        }
      }
    }
    case 'collapseGroupItems':
      return {
        ...state,
        groupVisibleCounts: {
          ...state.groupVisibleCounts,
          [action.groupId]: action.defaultCount
        }
      }
    case 'toggleGroup': {
      const collapsedGroups = state.collapsedGroups.includes(action.groupId)
        ? state.collapsedGroups.filter((groupId) => groupId !== action.groupId)
        : [...state.collapsedGroups, action.groupId]
      return { ...state, collapsedGroups }
    }
    case 'revealItem': {
      const nextGroupVisibleCounts = { ...state.groupVisibleCounts }

      if (action.groupId && action.visibleCount !== undefined) {
        nextGroupVisibleCounts[action.groupId] = Math.max(
          nextGroupVisibleCounts[action.groupId] ?? 0,
          action.visibleCount
        )
      }

      return {
        ...state,
        query: action.clearQuery ? '' : state.query,
        filters: action.clearFilters ? [] : state.filters,
        collapsedGroups: action.groupId
          ? state.collapsedGroups.filter((groupId) => groupId !== action.groupId)
          : state.collapsedGroups,
        groupVisibleCounts: nextGroupVisibleCounts,
        revealFocus: { itemId: action.itemId, requestId: action.requestId }
      }
    }
    case 'clearRevealFocus': {
      if (state.revealFocus?.itemId !== action.itemId || state.revealFocus.requestId !== action.requestId) {
        return state
      }

      return { ...state, revealFocus: null }
    }
    case 'startDrag':
      return { ...state, draggingId: action.id }
    case 'endDrag':
      return { ...state, draggingId: null }
    case 'setStatus':
      return { ...state, status: action.status }
  }
}

export function ResourceListProvider<T extends ResourceListItemBase>({
  items,
  children,
  variant = 'resource',
  status = 'idle',
  selectedId: selectedIdProp,
  defaultSortId,
  sortOptions = EMPTY_SORT_OPTIONS as ResourceListSortOption<T>[],
  filterOptions = EMPTY_FILTER_OPTIONS as ResourceListFilterOption<T>[],
  groupBy,
  getItemId = getDefaultItemId as (item: T) => string,
  getItemLabel = getDefaultItemLabel as (item: T) => string,
  getGroupHeaderAction,
  getGroupHeaderContextMenu,
  getGroupHeaderLeadingAction,
  getGroupHeaderIcon,
  getGroupHeaderClassName,
  getGroupHeaderTooltip,
  groupHeaderClickBehavior = 'toggle',
  collapsedGroupIds,
  revealRequest,
  dragCapabilities,
  canDragGroup,
  canDragItem,
  canDropGroup,
  canDropItem,
  defaultGroupVisibleCount = 5,
  groupLoadStep = 5,
  groupShowMoreLabel,
  groupCollapseLabel,
  estimateItemSize = estimateDefaultItemSize,
  onSelectItem,
  onRenameItem,
  onGroupHeaderSelectItem,
  onOpenContextMenu,
  onReorder,
  onCollapsedGroupIdsChange
}: ResourceListProviderProps<T>) {
  const [state, dispatch] = useReducer(reducer, {
    query: '',
    filters: [],
    sort: defaultSortId ?? null,
    selectedId: selectedIdProp ?? null,
    hoveredId: null,
    revealFocus: null,
    renamingId: null,
    collapsedGroups: [],
    groupVisibleCounts: {},
    draggingId: null,
    status
  })

  const filterById = useMemo(() => new Map(filterOptions.map((option) => [option.id, option])), [filterOptions])
  const sortById = useMemo(() => new Map(sortOptions.map((option) => [option.id, option])), [sortOptions])
  const effectiveCollapsedGroupIds = collapsedGroupIds ?? state.collapsedGroups
  const handledRevealRequestRef = useRef<string | null>(null)
  const getGroupHeaderClickBehavior = useCallback(
    (group: ResourceListGroup) =>
      typeof groupHeaderClickBehavior === 'function' ? groupHeaderClickBehavior(group) : groupHeaderClickBehavior,
    [groupHeaderClickBehavior]
  )

  useEffect(() => {
    if (!revealRequest) return

    const requestKey = `${revealRequest.requestId}:${revealRequest.itemId}`
    if (handledRevealRequestRef.current === requestKey) return

    const query = revealRequest.clearQuery ? '' : state.query
    const filters = revealRequest.clearFilters ? [] : state.filters
    const revealItems = deriveResourceListItems({
      filterById,
      filters,
      getItemLabel,
      items,
      query,
      sortById,
      sortId: state.sort
    })
    const revealTarget = findResourceListRevealTarget({
      defaultGroupVisibleCount,
      getItemId,
      groupBy,
      groupVisibleCounts: state.groupVisibleCounts,
      itemId: revealRequest.itemId,
      items: revealItems
    })
    if (!revealTarget) return

    if (
      collapsedGroupIds &&
      revealTarget.targetGroupId &&
      effectiveCollapsedGroupIds.includes(revealTarget.targetGroupId)
    ) {
      onCollapsedGroupIdsChange?.(
        effectiveCollapsedGroupIds.filter((groupId) => groupId !== revealTarget.targetGroupId)
      )
    }

    handledRevealRequestRef.current = requestKey
    dispatch({
      type: 'revealItem',
      clearFilters: revealRequest.clearFilters,
      clearQuery: revealRequest.clearQuery,
      groupId: revealTarget.targetGroupId,
      itemId: revealRequest.itemId,
      requestId: revealRequest.requestId,
      visibleCount: revealTarget.visibleCount
    })
  }, [
    collapsedGroupIds,
    effectiveCollapsedGroupIds,
    filterById,
    defaultGroupVisibleCount,
    getItemId,
    getItemLabel,
    groupBy,
    items,
    onCollapsedGroupIdsChange,
    revealRequest,
    sortById,
    state.filters,
    state.groupVisibleCounts,
    state.query,
    state.sort
  ])

  useEffect(() => {
    if (!state.revealFocus) return

    const { itemId, requestId } = state.revealFocus
    const timeout = window.setTimeout(() => {
      dispatch({ type: 'clearRevealFocus', itemId, requestId })
    }, 1000)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [state.revealFocus])

  const viewItems = useMemo(() => {
    return deriveResourceListItems({
      filterById,
      filters: state.filters,
      getItemLabel,
      items,
      query: state.query,
      sortById,
      sortId: state.sort
    })
  }, [filterById, getItemLabel, items, sortById, state.filters, state.query, state.sort])

  const viewGroups = useMemo(() => {
    return buildResourceListGroups({
      collapsedGroupIds: effectiveCollapsedGroupIds,
      defaultGroupVisibleCount,
      groupBy,
      groupVisibleCounts: state.groupVisibleCounts,
      items: viewItems
    })
  }, [defaultGroupVisibleCount, effectiveCollapsedGroupIds, groupBy, state.groupVisibleCounts, viewItems])

  const visibleItems = useMemo(() => viewGroups.flatMap((group) => group.items), [viewGroups])

  const actions = useMemo(
    () => ({
      setQuery: (query: string) => dispatch({ type: 'setQuery', query }),
      setFilters: (filters: string[]) => dispatch({ type: 'setFilters', filters }),
      toggleFilter: (filterId: string) => dispatch({ type: 'toggleFilter', filterId }),
      setSort: (sortId: string | null) => dispatch({ type: 'setSort', sort: sortId }),
      selectItem: (id: string) => {
        dispatch({ type: 'selectItem', id })
        onSelectItem?.(id)
      },
      hoverItem: (id: string | null) => dispatch({ type: 'hoverItem', id }),
      startRename: (id: string) => dispatch({ type: 'startRename', id }),
      commitRename: (id: string, name: string) => {
        onRenameItem?.(id, name)
        dispatch({ type: 'cancelRename' })
      },
      cancelRename: () => dispatch({ type: 'cancelRename' }),
      openContextMenu: (id: string) => onOpenContextMenu?.(id),
      selectGroupHeaderItem: (id: string) => {
        dispatch({ type: 'selectItem', id })
        const handleSelect = onGroupHeaderSelectItem ?? onSelectItem
        handleSelect?.(id)
      },
      showMoreInGroup: (groupId: string) => dispatch({ type: 'showMoreInGroup', groupId }),
      collapseGroupItems: (groupId: string) =>
        dispatch({ type: 'collapseGroupItems', groupId, defaultCount: defaultGroupVisibleCount }),
      toggleGroup: (groupId: string) => {
        if (collapsedGroupIds) {
          const nextCollapsedGroupIds = effectiveCollapsedGroupIds.includes(groupId)
            ? effectiveCollapsedGroupIds.filter((collapsedGroupId) => collapsedGroupId !== groupId)
            : [...effectiveCollapsedGroupIds, groupId]
          onCollapsedGroupIdsChange?.(nextCollapsedGroupIds)
          return
        }

        dispatch({ type: 'toggleGroup', groupId })
      },
      reorder: (payload: ResourceListReorderPayload) => onReorder?.(payload)
    }),
    [
      collapsedGroupIds,
      defaultGroupVisibleCount,
      effectiveCollapsedGroupIds,
      onCollapsedGroupIdsChange,
      onGroupHeaderSelectItem,
      onOpenContextMenu,
      onRenameItem,
      onReorder,
      onSelectItem
    ]
  )

  const context = useMemo<ResourceListContextValue<T>>(
    () => ({
      state: {
        ...state,
        collapsedGroups: [...effectiveCollapsedGroupIds],
        selectedId: selectedIdProp !== undefined ? selectedIdProp : state.selectedId,
        status
      },
      actions,
      meta: {
        variant,
        getItemId,
        getItemLabel,
        groups: viewGroups.map((group) => group.group),
        getGroupHeaderAction,
        getGroupHeaderContextMenu,
        getGroupHeaderLeadingAction,
        getGroupHeaderIcon,
        getGroupHeaderClassName,
        getGroupHeaderTooltip,
        getGroupHeaderClickBehavior,
        sortOptions,
        filterOptions,
        estimateItemSize,
        defaultGroupVisibleCount,
        groupLoadStep,
        groupShowMoreLabel,
        groupCollapseLabel,
        revealRequest,
        dragCapabilities: {
          groups: false,
          items: true,
          itemSameGroup: true,
          itemCrossGroup: false,
          ...dragCapabilities
        },
        canDragGroup,
        canDragItem,
        canDropGroup,
        canDropItem
      },
      sourceItems: items,
      view: {
        items: viewItems,
        visibleItems,
        groups: viewGroups
      }
    }),
    [
      actions,
      defaultGroupVisibleCount,
      dragCapabilities,
      effectiveCollapsedGroupIds,
      estimateItemSize,
      filterOptions,
      getItemId,
      getItemLabel,
      getGroupHeaderAction,
      getGroupHeaderContextMenu,
      getGroupHeaderLeadingAction,
      getGroupHeaderIcon,
      getGroupHeaderClassName,
      getGroupHeaderTooltip,
      getGroupHeaderClickBehavior,
      canDragGroup,
      canDragItem,
      canDropGroup,
      canDropItem,
      groupLoadStep,
      groupCollapseLabel,
      groupShowMoreLabel,
      revealRequest,
      items,
      selectedIdProp,
      sortOptions,
      state,
      status,
      variant,
      visibleItems,
      viewGroups,
      viewItems
    ]
  )

  return (
    <ResourceListContext value={context as unknown as ResourceListContextValue<ResourceListItemBase>}>
      {children}
    </ResourceListContext>
  )
}
