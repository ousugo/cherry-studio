import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'

import {
  ResourceListActionsContext,
  ResourceListContext,
  type ResourceListContextValue,
  ResourceListControlsContext,
  type ResourceListControlsState,
  type ResourceListDragCapabilities,
  type ResourceListFilterOption,
  type ResourceListGroup,
  type ResourceListGroupHeaderClickBehavior,
  type ResourceListItemAccessors,
  ResourceListItemAccessorsContext,
  type ResourceListItemBase,
  type ResourceListMeta,
  ResourceListMetaContext,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  type ResourceListSection,
  type ResourceListSortOption,
  ResourceListSourceItemsContext,
  type ResourceListState,
  type ResourceListStatus,
  ResourceListUiStoreContext,
  type ResourceListVariantContext,
  type ResourceListView,
  ResourceListViewContext,
  type ResourceListViewGroup,
  type ResourceListViewSection
} from './ResourceListContext'
import { RESOURCE_LIST_DEFAULT_ROW_SIZE } from './resourceListLayout'
import { ResourceListUiStore } from './ResourceListUiStore'

const EMPTY_SORT_OPTIONS: ResourceListSortOption<ResourceListItemBase>[] = []
const EMPTY_FILTER_OPTIONS: ResourceListFilterOption<ResourceListItemBase>[] = []
const getDefaultItemId = (item: ResourceListItemBase) => item.id
const getDefaultItemLabel = (item: ResourceListItemBase) => item.name
const estimateDefaultItemSize = () => RESOURCE_LIST_DEFAULT_ROW_SIZE
const UNGROUPED_RESOURCE_GROUP: ResourceListGroup = { id: 'ungrouped', label: '' }
const UNSECTIONED_RESOURCE_SECTION: ResourceListSection = { id: 'resource-list:section:unsectioned', label: '' }

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
  groupStateIds: readonly string[]
  defaultGroupVisibleCount: number
  groupBy?: (item: T) => ResourceListGroup | null
  groupVisibleCounts: Record<string, number>
  items: readonly T[]
  useExpandedGroupIds: boolean
}

type BuildResourceListSectionsOptions<T extends ResourceListItemBase> = BuildResourceListGroupsOptions<T> & {
  sectionBy?: (item: T) => ResourceListSection | null
}

type FindRevealTargetOptions<T extends ResourceListItemBase> = {
  defaultGroupVisibleCount: number
  getItemId: (item: T) => string
  groupBy?: (item: T) => ResourceListGroup | null
  groupVisibleCounts: Record<string, number>
  itemId: string
  items: readonly T[]
  sectionBy?: (item: T) => ResourceListSection | null
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
  groupStateIds,
  defaultGroupVisibleCount,
  groupBy,
  groupVisibleCounts,
  items,
  useExpandedGroupIds
}: BuildResourceListGroupsOptions<T>): ResourceListViewGroup<T>[] {
  const groupStateIdSet = new Set(groupStateIds)

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
    const collapsed =
      Boolean(group.label) && (useExpandedGroupIds ? !groupStateIdSet.has(group.id) : groupStateIdSet.has(group.id))
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

function buildResourceListSections<T extends ResourceListItemBase>({
  groupStateIds,
  defaultGroupVisibleCount,
  groupBy,
  groupVisibleCounts,
  items,
  sectionBy,
  useExpandedGroupIds
}: BuildResourceListSectionsOptions<T>): ResourceListViewSection<T>[] {
  if (!sectionBy) return []

  const groupStateIdSet = new Set(groupStateIds)
  const sections = new Map<string, { section: ResourceListSection; items: T[] }>()

  for (const item of items) {
    const section = sectionBy(item) ?? UNSECTIONED_RESOURCE_SECTION

    const existing = sections.get(section.id)
    if (existing) {
      existing.items.push(item)
    } else {
      sections.set(section.id, { section, items: [item] })
    }
  }

  const hasExpandedSectionIds =
    useExpandedGroupIds && [...sections.keys()].some((sectionId) => groupStateIdSet.has(sectionId))

  return [...sections.values()].map(({ section, items }) => {
    const collapsed = useExpandedGroupIds
      ? hasExpandedSectionIds && !groupStateIdSet.has(section.id)
      : groupStateIdSet.has(section.id)
    const groups = buildResourceListGroups({
      groupStateIds,
      defaultGroupVisibleCount,
      groupBy,
      groupVisibleCounts,
      items,
      useExpandedGroupIds
    })
    const visibleGroups = collapsed
      ? groups.map((group) => ({
          ...group,
          items: [],
          visibleCount: 0,
          hasMore: false,
          canCollapseToDefault: false
        }))
      : groups

    return {
      section: { ...section, count: section.count ?? items.length },
      groups: visibleGroups,
      allItems: items,
      totalCount: items.length,
      collapsed
    }
  })
}

function buildSectionStateGroups<T extends ResourceListItemBase>(
  sections: readonly ResourceListViewSection<T>[]
): ResourceListViewGroup<T>[] {
  return sections.map((section) => ({
    group: section.section,
    allItems: section.allItems,
    items: section.collapsed ? [] : section.groups.flatMap((group) => group.items),
    totalCount: section.totalCount,
    visibleCount: section.collapsed ? 0 : section.groups.reduce((count, group) => count + group.visibleCount, 0),
    hasMore: false,
    canCollapseToDefault: false,
    collapsed: section.collapsed
  }))
}

function getExpandedGroupIds<T extends ResourceListItemBase>(groups: readonly ResourceListViewGroup<T>[]) {
  return groups.filter((group) => Boolean(group.group.label) && !group.collapsed).map((group) => group.group.id)
}

function findResourceListRevealTarget<T extends ResourceListItemBase>({
  defaultGroupVisibleCount,
  getItemId,
  groupBy,
  groupVisibleCounts,
  itemId,
  items,
  sectionBy
}: FindRevealTargetOptions<T>) {
  const targetItem = items.find((item) => getItemId(item) === itemId)
  if (!targetItem) return null
  const targetSectionId = sectionBy ? (sectionBy(targetItem)?.id ?? UNSECTIONED_RESOURCE_SECTION.id) : null

  if (!groupBy) {
    return { targetGroupId: null, targetSectionId, visibleCount: undefined }
  }

  const targetGroupId = getResourceListGroup(targetItem, groupBy).id
  const groupItems = items.filter((item) => getResourceListGroup(item, groupBy).id === targetGroupId)
  const targetIndexInGroup = groupItems.findIndex((item) => getItemId(item) === itemId)
  const currentVisibleCount = groupVisibleCounts[targetGroupId] ?? defaultGroupVisibleCount
  const targetVisibleCount = targetIndexInGroup + 1
  const visibleCount =
    targetIndexInGroup >= 0 && targetVisibleCount > currentVisibleCount ? targetVisibleCount : undefined

  return { targetGroupId, targetSectionId, visibleCount }
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
  sectionBy?: (item: T) => ResourceListSection | null
  getItemId?: (item: T) => string
  getItemLabel?: (item: T) => string
  getSectionHeaderAction?: ResourceListMeta<T>['getSectionHeaderAction']
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
  | { type: 'collapseGroups'; groupIds: readonly string[] }
  | { type: 'toggleGroup'; groupId: string }
  | {
      type: 'revealItem'
      clearFilters?: boolean
      clearQuery?: boolean
      groupIds: string[]
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
    case 'collapseGroups': {
      const collapsedGroups = new Set(state.collapsedGroups)
      for (const groupId of action.groupIds) {
        collapsedGroups.add(groupId)
      }
      return { ...state, collapsedGroups: [...collapsedGroups] }
    }
    case 'toggleGroup': {
      const collapsedGroups = state.collapsedGroups.includes(action.groupId)
        ? state.collapsedGroups.filter((groupId) => groupId !== action.groupId)
        : [...state.collapsedGroups, action.groupId]
      return { ...state, collapsedGroups }
    }
    case 'revealItem': {
      const nextGroupVisibleCounts = { ...state.groupVisibleCounts }

      const targetGroupId = action.groupIds[0]
      if (targetGroupId && action.visibleCount !== undefined) {
        nextGroupVisibleCounts[targetGroupId] = Math.max(
          nextGroupVisibleCounts[targetGroupId] ?? 0,
          action.visibleCount
        )
      }

      return {
        ...state,
        query: action.clearQuery ? '' : state.query,
        filters: action.clearFilters ? [] : state.filters,
        collapsedGroups:
          action.groupIds.length > 0
            ? state.collapsedGroups.filter((groupId) => !action.groupIds.includes(groupId))
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
  sectionBy,
  getItemId = getDefaultItemId as (item: T) => string,
  getItemLabel = getDefaultItemLabel as (item: T) => string,
  getSectionHeaderAction,
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
  const effectiveGroupStateIds = collapsedGroupIds ?? state.collapsedGroups
  const useExpandedGroupIds = collapsedGroupIds !== undefined
  const effectiveSelectedId = selectedIdProp !== undefined ? selectedIdProp : state.selectedId
  const isSelectedControlled = selectedIdProp !== undefined
  const handledRevealRequestRef = useRef<string | null>(null)
  const stateGroupsRef = useRef<readonly ResourceListViewGroup<T>[]>([])
  const uiStoreRef = useRef<ResourceListUiStore | null>(null)
  if (!uiStoreRef.current) {
    uiStoreRef.current = new ResourceListUiStore({
      draggingId: state.draggingId,
      hoveredId: state.hoveredId,
      renamingId: state.renamingId,
      revealFocus: state.revealFocus,
      selectedId: effectiveSelectedId
    })
  }
  const uiStore = uiStoreRef.current
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
      items: revealItems,
      sectionBy
    })
    if (!revealTarget) return
    const revealGroupIds = [revealTarget.targetGroupId, revealTarget.targetSectionId].filter(
      (groupId): groupId is string => typeof groupId === 'string'
    )

    if (
      collapsedGroupIds !== undefined &&
      revealGroupIds.some((groupId) => !effectiveGroupStateIds.includes(groupId))
    ) {
      onCollapsedGroupIdsChange?.([...new Set([...effectiveGroupStateIds, ...revealGroupIds])])
    }

    handledRevealRequestRef.current = requestKey
    dispatch({
      type: 'revealItem',
      clearFilters: revealRequest.clearFilters,
      clearQuery: revealRequest.clearQuery,
      groupIds: revealGroupIds,
      itemId: revealRequest.itemId,
      requestId: revealRequest.requestId,
      visibleCount: revealTarget.visibleCount
    })
  }, [
    collapsedGroupIds,
    effectiveGroupStateIds,
    filterById,
    defaultGroupVisibleCount,
    getItemId,
    getItemLabel,
    groupBy,
    items,
    onCollapsedGroupIdsChange,
    revealRequest,
    sectionBy,
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

  const viewSections = useMemo(() => {
    return buildResourceListSections({
      groupStateIds: effectiveGroupStateIds,
      defaultGroupVisibleCount,
      groupBy,
      groupVisibleCounts: state.groupVisibleCounts,
      items: viewItems,
      sectionBy,
      useExpandedGroupIds
    })
  }, [
    defaultGroupVisibleCount,
    effectiveGroupStateIds,
    groupBy,
    sectionBy,
    state.groupVisibleCounts,
    useExpandedGroupIds,
    viewItems
  ])

  const viewGroups = useMemo(() => {
    if (sectionBy) return viewSections.flatMap((section) => section.groups)

    return buildResourceListGroups({
      groupStateIds: effectiveGroupStateIds,
      defaultGroupVisibleCount,
      groupBy,
      groupVisibleCounts: state.groupVisibleCounts,
      items: viewItems,
      useExpandedGroupIds
    })
  }, [
    defaultGroupVisibleCount,
    effectiveGroupStateIds,
    groupBy,
    sectionBy,
    state.groupVisibleCounts,
    useExpandedGroupIds,
    viewItems,
    viewSections
  ])

  const visibleItems = useMemo(() => viewGroups.flatMap((group) => group.items), [viewGroups])
  const stateGroups = useMemo(
    () => (sectionBy ? [...buildSectionStateGroups(viewSections), ...viewGroups] : viewGroups),
    [sectionBy, viewGroups, viewSections]
  )

  useLayoutEffect(() => {
    uiStore.setSelectedId(effectiveSelectedId)
  }, [effectiveSelectedId, uiStore])

  useLayoutEffect(() => {
    uiStore.setHoveredId(state.hoveredId)
  }, [state.hoveredId, uiStore])

  useLayoutEffect(() => {
    uiStore.setRenamingId(state.renamingId)
  }, [state.renamingId, uiStore])

  useLayoutEffect(() => {
    uiStore.setRevealFocus(state.revealFocus)
  }, [state.revealFocus, uiStore])

  useLayoutEffect(() => {
    uiStore.setDraggingId(state.draggingId)
  }, [state.draggingId, uiStore])

  useLayoutEffect(() => {
    uiStore.setViewGroups(stateGroups, getItemId)
  }, [getItemId, stateGroups, uiStore])

  useLayoutEffect(() => {
    stateGroupsRef.current = stateGroups
  }, [stateGroups])

  const actions = useMemo(
    () => ({
      setQuery: (query: string) => dispatch({ type: 'setQuery', query }),
      setFilters: (filters: string[]) => dispatch({ type: 'setFilters', filters }),
      toggleFilter: (filterId: string) => dispatch({ type: 'toggleFilter', filterId }),
      setSort: (sortId: string | null) => dispatch({ type: 'setSort', sort: sortId }),
      selectItem: (id: string) => {
        if (!isSelectedControlled) {
          uiStore.setSelectedId(id)
          dispatch({ type: 'selectItem', id })
        }
        onSelectItem?.(id)
      },
      hoverItem: (id: string | null) => {
        uiStore.setHoveredId(id)
        dispatch({ type: 'hoverItem', id })
      },
      startRename: (id: string) => {
        uiStore.setRenamingId(id)
        dispatch({ type: 'startRename', id })
      },
      commitRename: (id: string, name: string) => {
        onRenameItem?.(id, name)
        uiStore.setRenamingId(null)
        dispatch({ type: 'cancelRename' })
      },
      cancelRename: () => {
        uiStore.setRenamingId(null)
        dispatch({ type: 'cancelRename' })
      },
      openContextMenu: (id: string) => onOpenContextMenu?.(id),
      selectGroupHeaderItem: (id: string) => {
        if (!isSelectedControlled) {
          uiStore.setSelectedId(id)
          dispatch({ type: 'selectItem', id })
        }
        const handleSelect = onGroupHeaderSelectItem ?? onSelectItem
        handleSelect?.(id)
      },
      showMoreInGroup: (groupId: string) => dispatch({ type: 'showMoreInGroup', groupId }),
      collapseGroupItems: (groupId: string) =>
        dispatch({ type: 'collapseGroupItems', groupId, defaultCount: defaultGroupVisibleCount }),
      collapseGroups: (groupIds: readonly string[]) => {
        if (collapsedGroupIds !== undefined) {
          const nextExpandedGroupIds = new Set(effectiveGroupStateIds)
          for (const groupId of groupIds) {
            nextExpandedGroupIds.delete(groupId)
          }
          onCollapsedGroupIdsChange?.([...nextExpandedGroupIds])
          return
        }

        dispatch({ type: 'collapseGroups', groupIds })
      },
      toggleGroup: (groupId: string) => {
        if (collapsedGroupIds !== undefined) {
          const nextExpandedGroupIds = new Set(getExpandedGroupIds(stateGroupsRef.current))
          if (nextExpandedGroupIds.has(groupId)) {
            nextExpandedGroupIds.delete(groupId)
          } else {
            nextExpandedGroupIds.add(groupId)
          }
          onCollapsedGroupIdsChange?.([...nextExpandedGroupIds])
          return
        }

        dispatch({ type: 'toggleGroup', groupId })
      },
      reorder: (payload: ResourceListReorderPayload) => onReorder?.(payload)
    }),
    [
      collapsedGroupIds,
      defaultGroupVisibleCount,
      effectiveGroupStateIds,
      isSelectedControlled,
      onCollapsedGroupIdsChange,
      onGroupHeaderSelectItem,
      onOpenContextMenu,
      onRenameItem,
      onReorder,
      onSelectItem,
      uiStore
    ]
  )

  const controlsState = useMemo<ResourceListControlsState>(
    () => ({
      filters: state.filters,
      query: state.query,
      sort: state.sort,
      status
    }),
    [state.filters, state.query, state.sort, status]
  )

  const itemAccessors = useMemo<ResourceListItemAccessors<T>>(
    () => ({
      getItemId,
      getItemLabel
    }),
    [getItemId, getItemLabel]
  )

  const meta = useMemo<ResourceListMeta<T>>(
    () => ({
      variant,
      getItemId,
      getItemLabel,
      groups: viewGroups.map((group) => group.group),
      sections: viewSections.map((section) => section.section),
      getSectionHeaderAction,
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
    }),
    [
      canDragGroup,
      canDragItem,
      canDropGroup,
      canDropItem,
      defaultGroupVisibleCount,
      dragCapabilities,
      estimateItemSize,
      filterOptions,
      getSectionHeaderAction,
      getGroupHeaderAction,
      getGroupHeaderClassName,
      getGroupHeaderClickBehavior,
      getGroupHeaderContextMenu,
      getGroupHeaderIcon,
      getGroupHeaderLeadingAction,
      getGroupHeaderTooltip,
      getItemId,
      getItemLabel,
      groupCollapseLabel,
      groupLoadStep,
      groupShowMoreLabel,
      revealRequest,
      sortOptions,
      variant,
      viewGroups,
      viewSections
    ]
  )

  const view = useMemo<ResourceListView<T>>(
    () => ({
      items: viewItems,
      visibleItems,
      groups: viewGroups,
      sections: viewSections
    }),
    [viewGroups, viewItems, viewSections, visibleItems]
  )

  const legacyState = useMemo<ResourceListState>(
    () => ({
      ...state,
      collapsedGroups: [...effectiveGroupStateIds],
      selectedId: effectiveSelectedId,
      status
    }),
    [effectiveGroupStateIds, effectiveSelectedId, state, status]
  )

  const context = useMemo<ResourceListContextValue<T>>(
    () => ({
      state: legacyState,
      actions,
      meta,
      sourceItems: items,
      view
    }),
    [actions, items, legacyState, meta, view]
  )

  return (
    <ResourceListUiStoreContext value={uiStore}>
      <ResourceListActionsContext value={actions}>
        <ResourceListItemAccessorsContext
          value={itemAccessors as unknown as ResourceListItemAccessors<ResourceListItemBase>}>
          <ResourceListMetaContext value={meta as unknown as ResourceListMeta<ResourceListItemBase>}>
            <ResourceListSourceItemsContext value={items}>
              <ResourceListViewContext value={view as unknown as ResourceListView<ResourceListItemBase>}>
                <ResourceListControlsContext value={controlsState}>
                  <ResourceListContext value={context as unknown as ResourceListContextValue<ResourceListItemBase>}>
                    {children}
                  </ResourceListContext>
                </ResourceListControlsContext>
              </ResourceListViewContext>
            </ResourceListSourceItemsContext>
          </ResourceListMetaContext>
        </ResourceListItemAccessorsContext>
      </ResourceListActionsContext>
    </ResourceListUiStoreContext>
  )
}
