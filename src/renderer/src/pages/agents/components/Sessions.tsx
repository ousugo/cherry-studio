import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  ResourceList,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  SessionResourceList,
  useResourceList
} from '@renderer/components/chat/resources'
import { useOptionalTabsContext } from '@renderer/context/TabsContext'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSession'
import type { TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import { buildLibraryEditSearch, buildLibraryRouteUrl } from '@renderer/pages/library/routeSearch'
import { formatErrorMessage, formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import { Check, Clock3, ListFilter, Plus, SquarePen } from 'lucide-react'
import { memo, type MouseEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'
import {
  type AgentSessionDisplayMode,
  applyOptimisticSessionDisplayMove,
  buildSessionDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirLabelMap,
  createSessionWorkdirRankMap,
  getWorkdirPathFromSessionGroupId,
  normalizeSessionDropPayload,
  SESSION_PINNED_GROUP_ID,
  type SessionListItem,
  sortSessionsForDisplayGroups
} from './SessionList.helpers'

interface SessionsProps {
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  onSelectItem?: () => void
  onDiscardTemporarySession?: () => void | Promise<void>
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
}

const logger = loggerService.withContext('AgentSessions')

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'workdir']
const SESSION_TODAY_GROUP_ID = 'session:time:today'
const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}

function SessionDisplayModeMenu({
  mode,
  onChange
}: {
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('agent.session.display.title')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-28 rounded-lg border-border/80 p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <div className="px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground/60">
            {t('agent.session.display.title')}
          </div>
          {SESSION_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              label={t(SESSION_DISPLAY_LABEL_KEYS[option])}
              active={mode === option}
              suffix={mode === option ? <Check size={11} /> : null}
              className="h-6 gap-1.5 rounded-lg px-1.5 py-0 font-normal text-[11px] text-muted-foreground/75 hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground [&_svg]:size-3"
              onClick={() => {
                onChange(option)
                setOpen(false)
              }}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}

export function resolveCreateSessionAgentId(
  sessions: AgentSessionEntity[],
  activeSessionId: string | null,
  agents: AgentEntity[]
): string | null {
  const activeAgentId = sessions.find((s) => s.id === activeSessionId)?.agentId
  return activeAgentId ?? sessions[0]?.agentId ?? agents[0]?.id ?? null
}

const Sessions = ({
  onOpenHistory,
  onSelectItem,
  onDiscardTemporarySession,
  onStartTemporarySession,
  revealRequest
}: SessionsProps) => {
  const { t } = useTranslation()
  const tabs = useOptionalTabsContext()
  const [groupNow] = useState(() => new Date())
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [sessionDisplayMode, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const [collapsedSessionGroupIds, setCollapsedSessionGroupIds] = usePreference('agent.session.collapsed_group_ids')
  const {
    sessions,
    pinIdBySessionId,
    isLoading,
    isLoadingAll,
    isFullyLoaded,
    isPinsLoading: isSessionPinsLoading,
    error,
    deleteSession,
    hasMore,
    isLoadingMore,
    isValidating,
    reload,
    reorderSession,
    togglePin
  } = useSessions(undefined, { loadAll: true, pageSize: 50 })
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const { agents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)

  const { data: channels } = useQuery('/channels')
  const channelTypeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const ch of channels ?? []) {
      if (ch.sessionId) map[ch.sessionId] = ch.type
    }
    return map
  }, [channels])

  const displayMode: AgentSessionDisplayMode = sessionDisplayMode === 'workdir' ? 'workdir' : 'time'
  const isDraggableMode = displayMode === 'workdir'
  const dragReady = isDraggableMode && isFullyLoaded && !isLoadingAll && !isLoadingMore && !isValidating && !isLoading

  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: pinIdBySessionId.has(session.id) })),
    [pinIdBySessionId, sessions]
  )

  const fallbackAgentId = useMemo(
    () => resolveCreateSessionAgentId(sessionItems, activeSessionId, agents),
    [sessionItems, activeSessionId, agents]
  )
  const { updateSession } = useUpdateSession()

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const workdirLabelByPath = useMemo(() => createSessionWorkdirLabelMap(sessionItems), [sessionItems])
  const workdirRankByPath = useMemo(() => createSessionWorkdirRankMap(sessionItems), [sessionItems])

  const baseGroupedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        mode: displayMode,
        now: groupNow,
        workdirRankByPath
      }),
    [displayMode, groupNow, sessionItems, workdirRankByPath]
  )

  const groupedSessions = useMemo(
    () =>
      optimisticMove ? applyOptimisticSessionDisplayMove(baseGroupedSessions, optimisticMove) : baseGroupedSessions,
    [baseGroupedSessions, optimisticMove]
  )

  const sessionOrderSignature = useMemo(
    () =>
      sessionItems
        .map((session) => `${session.id}:${session.agentId ?? ''}:${session.orderKey}:${session.pinned ? '1' : '0'}`)
        .join('|'),
    [sessionItems]
  )

  useEffect(() => {
    setOptimisticMove(null)
  }, [sessionOrderSignature])

  const sessionGroupBy = useMemo(
    () =>
      createSessionDisplayGroupResolver({
        labels: {
          pinned: t('selector.common.pinned_title'),
          time: {
            today: t('agent.session.group.today'),
            yesterday: t('agent.session.group.yesterday'),
            'this-week': t('agent.session.group.this_week'),
            earlier: t('agent.session.group.earlier')
          },
          workdir: {
            none: t('agent.session.group.no_workdir')
          }
        },
        mode: displayMode,
        now: groupNow,
        workdirLabelByPath
      }),
    [displayMode, groupNow, t, workdirLabelByPath]
  )

  const handleCollapsedSessionGroupIdsChange = useCallback(
    (nextGroupIds: string[]) => void setCollapsedSessionGroupIds(nextGroupIds),
    [setCollapsedSessionGroupIds]
  )
  const handleOpenHistoryOrToggleSidebar = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (onOpenHistory) {
        onOpenHistory(event.currentTarget.getBoundingClientRect())
        return
      }

      void setShowSidebar(!showSidebar)
    },
    [onOpenHistory, setShowSidebar, showSidebar]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const success = await deleteSession(id)
      if (success && activeSessionId === id) {
        const remaining = sessionItems.find((s) => s.id !== id)
        setActiveSessionId(remaining?.id ?? null)
      }
    },
    [activeSessionId, deleteSession, sessionItems, setActiveSessionId]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessionItems.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const updatedSession = await updateSession({ id, name: trimmedName }, { showSuccessToast: false })
        if (updatedSession) {
          window.toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session', { err, sessionId: id })
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessionItems, t, updateSession]
  )

  const { trigger: findOrCreateWorkspace } = useMutation('POST', '/workspaces', { refresh: ['/workspaces'] })

  const createSessionForGroup = useCallback(
    async (agentId: string | null | undefined, workspacePath?: string) => {
      if (!agentId || creatingSession) return null

      const agent = agentById.get(agentId)
      if (!agent) return null

      if (!agent.model) {
        window.toast.error(t('error.model.not_exists'))
        return null
      }

      setCreatingSession(true)
      try {
        // A workdir group binds new sessions to that folder — resolve it to a
        // workspace (idempotent on path) before starting the draft session.
        const workspaceId = workspacePath
          ? (await findOrCreateWorkspace({ body: { path: workspacePath } })).id
          : undefined

        await onStartTemporarySession?.({
          agentId,
          name: t('common.unnamed'),
          ...(workspaceId ? { workspaceId } : {})
        })

        setActiveSessionId(null)
        return null
      } catch (err) {
        logger.error('Failed to create session from session list', { err, agentId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
        return null
      } finally {
        setCreatingSession(false)
      }
    },
    [agentById, creatingSession, findOrCreateWorkspace, onStartTemporarySession, setActiveSessionId, t]
  )

  const handleHeaderCreateSession = useCallback(() => {
    void createSessionForGroup(fallbackAgentId)
  }, [createSessionForGroup, fallbackAgentId])
  const openAgentEditor = useCallback(
    (agentId: string) => {
      tabs?.openTab(buildLibraryRouteUrl(buildLibraryEditSearch('agent', agentId)), { forceNew: true })
    },
    [tabs]
  )

  const handleSelectSession = useCallback(
    (id: string | null) => {
      if (id) void onDiscardTemporarySession?.()
      setActiveSessionId(id)
    },
    [onDiscardTemporarySession, setActiveSessionId]
  )

  const canDragSessionItem = useCallback(
    ({ item }: { item: SessionListItem }) => dragReady && !item.pinned,
    [dragReady]
  )

  const canDropSessionItem = useCallback(
    ({ sourceGroupId, targetGroupId }: { sourceGroupId: string; targetGroupId: string }) =>
      dragReady && canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, dragReady]
  )

  const handleSessionReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type !== 'item') return
      if (!dragReady) return
      if (
        !canDropSessionItemInDisplayGroup({
          mode: displayMode,
          sourceGroupId: payload.sourceGroupId,
          targetGroupId: payload.targetGroupId
        })
      ) {
        return
      }

      const session = sessionItems.find((candidate) => candidate.id === payload.activeId)
      if (!session || session.pinned) return

      const normalizedPayload = normalizeSessionDropPayload(payload)
      const anchor = buildSessionDropAnchor(normalizedPayload)
      setOptimisticMove(normalizedPayload)

      const reordered = await reorderSession(payload.activeId, anchor)
      if (!reordered) {
        setOptimisticMove(null)
      }
    },
    [displayMode, dragReady, reorderSession, sessionItems]
  )

  const getGroupHeaderAction = useCallback(
    (group: { id: string }) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      let payload: { agentId: string | null | undefined; workspacePath?: string } | null = null
      if (displayMode === 'time') {
        if (group.id !== SESSION_TODAY_GROUP_ID) return null
        payload = { agentId: fallbackAgentId }
      } else {
        const path = getWorkdirPathFromSessionGroupId(group.id)
        if (!path) return null
        payload = { agentId: fallbackAgentId, workspacePath: path }
      }

      if (!payload.agentId) return null

      return (
        <>
          <Tooltip title={t('agent.session.add.title')} delay={500}>
            <ResourceList.HeaderActionButton
              type="button"
              aria-label={t('agent.session.add.title')}
              disabled={creatingSession || !agentById.has(payload.agentId)}
              onClick={() => void createSessionForGroup(payload.agentId, payload.workspacePath)}>
              <Plus className="block" />
            </ResourceList.HeaderActionButton>
          </Tooltip>
        </>
      )
    },
    [agentById, createSessionForGroup, creatingSession, displayMode, fallbackAgentId, t]
  )

  const listError = error
  const listLoading = isLoadingAll || !isFullyLoaded || isSessionPinsLoading
  const visibleGroupedSessions = useMemo(() => (listLoading ? [] : groupedSessions), [groupedSessions, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : groupedSessions.length === 0 ? 'empty' : 'idle'

  return (
    <SessionResourceList<SessionListItem>
      items={visibleGroupedSessions}
      status={listStatus}
      selectedId={activeSessionId}
      estimateItemSize={() => 34}
      groupBy={sessionGroupBy}
      collapsedGroupIds={collapsedSessionGroupIds}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={5}
      groupLoadStep={5}
      getGroupHeaderAction={getGroupHeaderAction}
      dragCapabilities={{
        groups: false,
        items: dragReady,
        itemSameGroup: dragReady,
        itemCrossGroup: false
      }}
      canDragItem={canDragSessionItem}
      canDropItem={canDropSessionItem}
      groupShowMoreLabel={t('agent.session.group.show_more')}
      groupCollapseLabel={t('agent.session.group.collapse')}
      onRenameItem={handleRenameSession}
      onReorder={handleSessionReorder}
      onCollapsedGroupIdsChange={handleCollapsedSessionGroupIdsChange}>
      <ResourceList.Header className="gap-1 px-1.5 pb-0">
        <ResourceList.HeaderItem
          type="button"
          aria-label={t('chat.conversation.new')}
          disabled={creatingSession}
          icon={<SquarePen />}
          label={t('chat.conversation.new')}
          onClick={handleHeaderCreateSession}
          actions={
            <SessionDisplayModeMenu mode={displayMode} onChange={(nextMode) => void setSessionDisplayMode(nextMode)} />
          }
        />
        <ResourceList.HeaderItem
          type="button"
          aria-label={onOpenHistory ? t('history.records.agentTitle') : t('shortcut.general.toggle_sidebar')}
          icon={<Clock3 />}
          label={t('history.records.shortTitle')}
          onClick={handleOpenHistoryOrToggleSidebar}
        />
      </ResourceList.Header>
      <SessionListBody
        channelTypeMap={channelTypeMap}
        error={listError}
        isDraggable={dragReady}
        isValidating={isValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onEditAgent={openAgentEditor}
        onRetry={reload}
        onSelectItem={onSelectItem}
        onTogglePin={togglePin}
        setActiveSessionId={handleSelectSession}
      />
      {!listLoading && (isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
    </SessionResourceList>
  )
}

interface SessionListBodyProps {
  channelTypeMap: Record<string, string>
  error?: unknown
  isDraggable: boolean
  isValidating: boolean
  listRef: RefObject<HTMLDivElement | null>
  onDeleteSession: (id: string) => Promise<void>
  onEditAgent: (agentId: string) => void
  onRetry: () => Promise<unknown>
  onSelectItem?: () => void
  onTogglePin: (id: string) => Promise<void>
  setActiveSessionId: (id: string | null) => void
}

function SessionListBody({
  channelTypeMap,
  error,
  isDraggable,
  isValidating,
  listRef,
  onDeleteSession,
  onEditAgent,
  onRetry,
  onSelectItem,
  onTogglePin,
  setActiveSessionId
}: SessionListBodyProps) {
  const { t } = useTranslation()
  const context = useResourceList<SessionListItem>()

  if (context.state.status === 'loading') {
    return <ResourceList.LoadingState />
  }

  if (context.state.status === 'error') {
    return (
      <ResourceList.ErrorState>
        <div className="flex flex-col gap-2">
          <div className="font-medium text-destructive">{t('agent.session.get.error.failed')}</div>
          <div className="text-muted-foreground">{formatErrorMessage(error)}</div>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => void onRetry()} disabled={isValidating}>
            {t('common.retry')}
          </Button>
        </div>
      </ResourceList.ErrorState>
    )
  }

  if (context.view.items.length === 0) {
    return <ResourceList.EmptyState />
  }

  const renderItem = (session: SessionListItem) => (
    <SessionItem
      key={session.id}
      session={session}
      channelType={channelTypeMap[session.id]}
      pinned={session.pinned}
      onTogglePin={onTogglePin}
      onDelete={onDeleteSession}
      onEditAgent={onEditAgent}
      onPress={setActiveSessionId}
      onSelectItem={onSelectItem}
    />
  )

  if (isDraggable) {
    return <ResourceList.VirtualDraggableItems ref={listRef} className="pt-0 pb-3" renderItem={renderItem} />
  }

  return <ResourceList.VirtualItems ref={listRef} className="pt-0 pb-3" renderItem={renderItem} />
}

export default memo(Sessions)
