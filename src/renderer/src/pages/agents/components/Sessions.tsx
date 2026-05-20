import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import {
  ResourceList,
  type ResourceListGroup,
  type ResourceListItemReorderPayload,
  type ResourceListReorderPayload,
  type ResourceListRevealRequest,
  SessionResourceList,
  useResourceList
} from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { FinderIcon } from '@renderer/components/Icons/SVGIcon'
import { isMac, isWin } from '@renderer/config/constant'
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
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import type { AgentEntity } from '@shared/data/types/agent'
import { Check, Clock3, FolderOpen, ListFilter, MoreHorizontal, SquarePen, Trash2 } from 'lucide-react'
import { memo, type MouseEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SessionItem from './SessionItem'
import {
  type AgentSessionDisplayMode,
  applyOptimisticSessionDisplayMove,
  buildSessionDropAnchor,
  buildSessionWorkdirGroupDropAnchor,
  canDropSessionItemInDisplayGroup,
  createSessionDisplayGroupResolver,
  createSessionWorkdirDisplayMaps,
  getWorkdirPathFromSessionGroupId,
  moveSessionWorkdirGroupAfterDrop,
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
const EMPTY_WORKSPACE_ROWS: WorkspaceEntity[] = []

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

function WorkdirGroupMoreMenu({
  canDelete,
  canRename,
  deleteDisabled,
  group,
  onDelete,
  onOpen,
  onRename,
  renameDisabled,
  workdirPath
}: {
  canDelete: boolean
  canRename: boolean
  deleteDisabled?: boolean
  group: ResourceListGroup
  onDelete: (group: ResourceListGroup) => void | Promise<void>
  onOpen: (workdirPath: string) => void | Promise<void>
  onRename: (group: ResourceListGroup) => void | Promise<void>
  renameDisabled?: boolean
  workdirPath: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const fileManagerName = useMemo(() => {
    if (isMac) return t('agent.session.file_manager.finder')
    if (isWin) return t('agent.session.file_manager.file_explorer')
    return t('agent.session.file_manager.files')
  }, [t])
  const openLabel = t('common.open_in', { name: fileManagerName })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton
          type="button"
          aria-label={t('common.more')}
          onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 rounded-lg border-border p-1 shadow-lg">
        <MenuList className="gap-0.5">
          <MenuItem
            label={openLabel}
            icon={isMac ? <FinderIcon className="size-3.5" /> : <FolderOpen size={14} />}
            className="h-7 gap-2 rounded-lg px-2 py-0 font-normal text-[12px]"
            onClick={(event) => {
              event.stopPropagation()
              setOpen(false)
              void onOpen(workdirPath)
            }}
          />
          {canRename && (
            <MenuItem
              label={t('agent.session.workdir.rename.trigger')}
              icon={<SquarePen size={14} />}
              disabled={renameDisabled}
              className="h-7 gap-2 rounded-lg px-2 py-0 font-normal text-[12px]"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                void onRename(group)
              }}
            />
          )}
          {canDelete && (
            <MenuItem
              label={t('agent.session.workdir.delete.trigger')}
              icon={<Trash2 size={14} className="lucide-custom text-destructive" />}
              disabled={deleteDisabled}
              className="h-7 gap-2 rounded-lg px-2 py-0 font-normal text-[12px] text-destructive hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                void onDelete(group)
              }}
            />
          )}
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

export function resolveCreateSessionWorkspaceId(
  sessions: AgentSessionEntity[],
  activeSessionId: string | null,
  agentId: string | null | undefined
): string | undefined {
  if (!agentId) return undefined

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  if (activeSession?.agentId === agentId && activeSession.workspaceId) {
    return activeSession.workspaceId
  }

  return sessions.find((session) => session.agentId === agentId && session.workspaceId)?.workspaceId ?? undefined
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
  } = useSessions(undefined, { loadAll: true, pageSize: 200 })
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const { agents } = useAgents()
  const listRef = useRef<HTMLDivElement>(null)
  const [optimisticMove, setOptimisticMove] = useState<ResourceListItemReorderPayload | null>(null)
  const [optimisticWorkspaceOrderIds, setOptimisticWorkspaceOrderIds] = useState<string[] | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const [deletingWorkspaceGroupId, setDeletingWorkspaceGroupId] = useState<string | null>(null)
  const [renamingWorkspaceGroup, setRenamingWorkspaceGroup] = useState<{
    name: string
    workspaceId: string
  } | null>(null)

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
  const {
    data: workspaces,
    error: workspacesError,
    isLoading: isWorkspacesLoading,
    isRefreshing: isWorkspacesRefreshing,
    refetch: refetchWorkspaces
  } = useQuery('/workspaces', { enabled: displayMode === 'workdir' })
  const workspaceRows = workspaces ?? EMPTY_WORKSPACE_ROWS
  const isWorkdirMetadataLoading = displayMode === 'workdir' && isWorkspacesLoading
  const isWorkdirMetadataRefreshing = displayMode === 'workdir' && isWorkspacesRefreshing
  const workdirDragReady = dragReady && !isWorkdirMetadataLoading && !isWorkdirMetadataRefreshing
  const workspaceRowsForDisplay = useMemo(() => {
    if (!optimisticWorkspaceOrderIds) return workspaceRows

    const workspaceById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]))
    const orderedWorkspaces: typeof workspaceRows = []
    for (const workspaceId of optimisticWorkspaceOrderIds) {
      const workspace = workspaceById.get(workspaceId)
      if (workspace) {
        orderedWorkspaces.push(workspace)
      }
    }
    const orderedIds = new Set(orderedWorkspaces.map((workspace) => workspace.id))
    const remainingWorkspaces = workspaceRows.filter((workspace) => !orderedIds.has(workspace.id))

    return [...orderedWorkspaces, ...remainingWorkspaces]
  }, [optimisticWorkspaceOrderIds, workspaceRows])
  const workdirDisplay = useMemo(
    () => createSessionWorkdirDisplayMaps(sessionItems, workspaceRowsForDisplay),
    [sessionItems, workspaceRowsForDisplay]
  )
  const workspaceOrderSignature = useMemo(
    () => workspaceRows.map((workspace) => `${workspace.id}:${workspace.orderKey}`).join('|'),
    [workspaceRows]
  )

  const baseGroupedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        mode: displayMode,
        now: groupNow,
        workdirDisplay
      }),
    [displayMode, groupNow, sessionItems, workdirDisplay]
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

  useEffect(() => {
    setOptimisticWorkspaceOrderIds(null)
  }, [workspaceOrderSignature])

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
        workdirDisplay
      }),
    [displayMode, groupNow, t, workdirDisplay]
  )

  const effectiveCollapsedSessionGroupIds = useMemo(() => {
    if (displayMode !== 'workdir') return collapsedSessionGroupIds

    return Array.from(
      new Set(
        collapsedSessionGroupIds.map((groupId) => {
          const path = getWorkdirPathFromSessionGroupId(groupId)
          return path ? (workdirDisplay.groupIdByPath.get(path) ?? groupId) : groupId
        })
      )
    )
  }, [collapsedSessionGroupIds, displayMode, workdirDisplay])

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
  const { trigger: updateWorkspace, isLoading: isUpdatingWorkspace } = useMutation(
    'PATCH',
    '/workspaces/:workspaceId',
    {
      refresh: ['/workspaces', '/sessions']
    }
  )
  const { trigger: deleteWorkspace } = useMutation('DELETE', '/workspaces/:workspaceId', {
    refresh: ['/sessions', '/workspaces', '/pins', '/channels']
  })
  const { trigger: reorderWorkspace } = useMutation('PATCH', '/workspaces/:id/order')

  const createSessionForGroup = useCallback(
    async (agentId: string | null | undefined, workspace?: { workspaceId?: string; workspacePath?: string }) => {
      if (!agentId || creatingSession) return null

      const agent = agentById.get(agentId)
      if (!agent) return null

      if (!agent.model) {
        window.toast.error(t('error.model.not_exists'))
        return null
      }

      setCreatingSession(true)
      try {
        const workspaceId = workspace?.workspaceId
          ? workspace.workspaceId
          : workspace?.workspacePath
            ? (await findOrCreateWorkspace({ body: { path: workspace.workspacePath } })).id
            : resolveCreateSessionWorkspaceId(sessionItems, activeSessionId, agentId)

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
    [
      activeSessionId,
      agentById,
      creatingSession,
      findOrCreateWorkspace,
      onStartTemporarySession,
      sessionItems,
      setActiveSessionId,
      t
    ]
  )

  const handleHeaderCreateSession = useCallback(() => {
    void createSessionForGroup(fallbackAgentId)
  }, [createSessionForGroup, fallbackAgentId])

  const handleRetry = useCallback(async () => {
    await reload()
    if (displayMode === 'workdir') {
      await refetchWorkspaces()
    }
  }, [displayMode, refetchWorkspaces, reload])

  const handleDeleteWorkdirGroup = useCallback(
    async (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId || deletingWorkspaceGroupId) return

      const sessionIds = sessionItems
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => session.id)
      if (sessionIds.length === 0) return

      const confirmed = await window.modal.confirm({
        title: t('agent.session.workdir.delete.title'),
        content: t('agent.session.workdir.delete.content'),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        centered: true,
        okButtonProps: {
          danger: true
        }
      })
      if (!confirmed) return

      setDeletingWorkspaceGroupId(group.id)
      const affectedSessionIds = new Set(sessionIds)

      try {
        await deleteWorkspace({ params: { workspaceId } })

        if (activeSessionId && affectedSessionIds.has(activeSessionId)) {
          const remaining = sessionItems.find((session) => !affectedSessionIds.has(session.id))
          setActiveSessionId(remaining?.id ?? null)
        }

        await reload()
        await refetchWorkspaces()
        window.toast.success(t('common.delete_success'))
      } catch (err) {
        logger.error('Failed to delete workspace group', { err, sessionIds, workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.delete.error.failed')))
      } finally {
        setDeletingWorkspaceGroupId(null)
      }
    },
    [
      activeSessionId,
      deleteWorkspace,
      deletingWorkspaceGroupId,
      refetchWorkspaces,
      reload,
      sessionItems,
      setActiveSessionId,
      t,
      workdirDisplay
    ]
  )

  const handleStartRenameWorkdirGroup = useCallback(
    (group: ResourceListGroup) => {
      const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
      if (!workspaceId) return

      setRenamingWorkspaceGroup({
        name: group.label,
        workspaceId
      })
    },
    [workdirDisplay]
  )

  const handleRenameWorkdirGroup = useCallback(
    async (name: string) => {
      const target = renamingWorkspaceGroup
      const trimmedName = name.trim()
      if (!target || !trimmedName || trimmedName === target.name.trim()) return

      try {
        await updateWorkspace({
          body: { name: trimmedName },
          params: { workspaceId: target.workspaceId }
        })
        window.toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename workspace group', { err, workspaceId: target.workspaceId })
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.workdir.rename.error.failed')))
      }
    },
    [renamingWorkspaceGroup, t, updateWorkspace]
  )

  const handleOpenWorkdirGroup = useCallback(
    async (workdirPath: string) => {
      try {
        await window.api.file.openPath(workdirPath)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('files.error.open_path', { path: workdirPath })))
      }
    },
    [t]
  )

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
    ({ item }: { item: SessionListItem }) => workdirDragReady && !item.pinned,
    [workdirDragReady]
  )

  const canDropSessionItem = useCallback(
    ({ sourceGroupId, targetGroupId }: { sourceGroupId: string; targetGroupId: string }) =>
      workdirDragReady && canDropSessionItemInDisplayGroup({ mode: displayMode, sourceGroupId, targetGroupId }),
    [displayMode, workdirDragReady]
  )

  const canDragSessionGroup = useCallback(
    (group: ResourceListGroup) => workdirDragReady && workdirDisplay.workspaceIdByGroupId.has(group.id),
    [workdirDragReady, workdirDisplay]
  )

  const canDropSessionGroup = useCallback(
    ({ activeGroupId, overGroupId }: { activeGroupId: string; overGroupId: string }) => {
      const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(activeGroupId)
      const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(overGroupId)

      return workdirDragReady && !!activeWorkspaceId && !!overWorkspaceId && activeWorkspaceId !== overWorkspaceId
    },
    [workdirDragReady, workdirDisplay]
  )

  const handleSessionReorder = useCallback(
    async (payload: ResourceListReorderPayload) => {
      if (payload.type === 'group') {
        if (!workdirDragReady) return

        const activeWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.activeGroupId)
        const overWorkspaceId = workdirDisplay.workspaceIdByGroupId.get(payload.overGroupId)

        if (!activeWorkspaceId || !overWorkspaceId || activeWorkspaceId === overWorkspaceId) return

        const nextWorkspaceRows = moveSessionWorkdirGroupAfterDrop(
          workspaceRowsForDisplay,
          activeWorkspaceId,
          overWorkspaceId,
          payload
        )
        const anchor = buildSessionWorkdirGroupDropAnchor(payload, overWorkspaceId)

        setOptimisticWorkspaceOrderIds(nextWorkspaceRows.map((workspace) => workspace.id))

        try {
          await reorderWorkspace({ params: { id: activeWorkspaceId }, body: anchor })
          await refetchWorkspaces()
          setOptimisticWorkspaceOrderIds(null)
        } catch (err) {
          setOptimisticWorkspaceOrderIds(null)
          logger.error('Failed to reorder workspace group', {
            activeWorkspaceId,
            err,
            overWorkspaceId
          })
          window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.reorder.error.failed')))

          try {
            await refetchWorkspaces()
          } catch (refreshErr) {
            logger.error('Failed to refresh workspaces after group reorder failure', {
              activeWorkspaceId,
              refreshErr
            })
          }
        }

        return
      }

      if (!workdirDragReady) return
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
    [
      displayMode,
      refetchWorkspaces,
      reorderSession,
      reorderWorkspace,
      sessionItems,
      t,
      workdirDragReady,
      workdirDisplay,
      workspaceRowsForDisplay
    ]
  )

  const getGroupHeaderAction = useCallback(
    (group: ResourceListGroup) => {
      if (group.id === SESSION_PINNED_GROUP_ID) return null

      let payload: { agentId: string | null | undefined; workspaceId?: string; workspacePath?: string } | null = null
      if (displayMode === 'time') {
        if (group.id !== SESSION_TODAY_GROUP_ID) return null
        payload = { agentId: fallbackAgentId }
      } else {
        const workspaceId = workdirDisplay.workspaceIdByGroupId.get(group.id)
        const path = getWorkdirPathFromSessionGroupId(group.id)
        if (workspaceId) {
          payload = { agentId: fallbackAgentId, workspaceId }
        } else if (path) {
          payload = { agentId: fallbackAgentId, workspacePath: path }
        } else {
          return null
        }
      }

      const workspaceId = displayMode === 'workdir' ? workdirDisplay.workspaceIdByGroupId.get(group.id) : undefined
      const workdirPath =
        displayMode === 'workdir'
          ? (workdirDisplay.pathByGroupId.get(group.id) ?? getWorkdirPathFromSessionGroupId(group.id))
          : undefined
      const createSessionAgentId =
        typeof payload.agentId === 'string' && payload.agentId.length > 0 ? payload.agentId : null
      const canCreateSession = createSessionAgentId !== null

      if (!canCreateSession && !workdirPath) return null

      return (
        <>
          {workdirPath && (
            <Tooltip title={t('common.more')} delay={500}>
              <WorkdirGroupMoreMenu
                canDelete={!!workspaceId}
                canRename={!!workspaceId}
                deleteDisabled={!!deletingWorkspaceGroupId}
                group={group}
                renameDisabled={isUpdatingWorkspace}
                workdirPath={workdirPath}
                onDelete={handleDeleteWorkdirGroup}
                onOpen={handleOpenWorkdirGroup}
                onRename={handleStartRenameWorkdirGroup}
              />
            </Tooltip>
          )}
          {canCreateSession && (
            <Tooltip title={t('chat.conversation.new')} delay={500}>
              <ResourceList.HeaderActionButton
                type="button"
                aria-label={t('chat.conversation.new')}
                disabled={creatingSession || !agentById.has(createSessionAgentId)}
                onClick={() => {
                  const workspace = payload.workspaceId
                    ? { workspaceId: payload.workspaceId }
                    : payload.workspacePath
                      ? { workspacePath: payload.workspacePath }
                      : undefined
                  void createSessionForGroup(createSessionAgentId, workspace)
                }}>
                <SquarePen className="block" />
              </ResourceList.HeaderActionButton>
            </Tooltip>
          )}
        </>
      )
    },
    [
      agentById,
      createSessionForGroup,
      creatingSession,
      deletingWorkspaceGroupId,
      displayMode,
      fallbackAgentId,
      handleDeleteWorkdirGroup,
      handleOpenWorkdirGroup,
      handleStartRenameWorkdirGroup,
      isUpdatingWorkspace,
      t,
      workdirDisplay
    ]
  )

  const listError = error ?? (displayMode === 'workdir' ? workspacesError : undefined)
  const listLoading = isLoadingAll || !isFullyLoaded || isSessionPinsLoading || isWorkdirMetadataLoading
  const listValidating = isValidating || isWorkdirMetadataRefreshing
  const visibleGroupedSessions = useMemo(() => (listLoading ? [] : groupedSessions), [groupedSessions, listLoading])
  const listStatus = listError ? 'error' : listLoading ? 'loading' : groupedSessions.length === 0 ? 'empty' : 'idle'

  return (
    <SessionResourceList<SessionListItem>
      items={visibleGroupedSessions}
      status={listStatus}
      selectedId={activeSessionId}
      estimateItemSize={() => 34}
      groupBy={sessionGroupBy}
      collapsedGroupIds={effectiveCollapsedSessionGroupIds}
      revealRequest={revealRequest}
      defaultGroupVisibleCount={5}
      groupLoadStep={5}
      getGroupHeaderAction={getGroupHeaderAction}
      dragCapabilities={{
        groups: workdirDragReady,
        items: workdirDragReady,
        itemSameGroup: workdirDragReady,
        itemCrossGroup: false
      }}
      canDragGroup={canDragSessionGroup}
      canDropGroup={canDropSessionGroup}
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
        isValidating={listValidating}
        listRef={listRef}
        onDeleteSession={handleDeleteSession}
        onEditAgent={openAgentEditor}
        onRetry={handleRetry}
        onSelectItem={onSelectItem}
        onTogglePin={togglePin}
        setActiveSessionId={handleSelectSession}
      />
      {!listLoading && (isLoadingMore || hasMore) && (
        <div className="shrink-0 px-3 py-2 text-center text-[11px] text-muted-foreground/55">{t('common.loading')}</div>
      )}
      <EditNameDialog
        open={!!renamingWorkspaceGroup}
        title={t('agent.session.workdir.rename.title')}
        initialName={renamingWorkspaceGroup?.name ?? ''}
        onSubmit={handleRenameWorkdirGroup}
        onOpenChange={(open) => {
          if (!open) setRenamingWorkspaceGroup(null)
        }}
      />
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
