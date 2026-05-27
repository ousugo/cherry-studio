import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCache } from '@renderer/data/hooks/useCache'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import {
  type AgentSessionStreamState,
  useAgentSessionStreamStatuses
} from '@renderer/hooks/agents/useAgentSessionStreamStatuses'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useTopicMutations, useTopics } from '@renderer/hooks/useTopic'
import type { SessionActionContext } from '@renderer/pages/agents/components/sessionItemActions'
import {
  createSessionWorkdirDisplayMaps,
  getPrimarySessionWorkdir,
  getSessionWorkdirFallbackLabel,
  type SessionListItem,
  type SessionWorkdirDisplayMaps,
  sortSessionsForDisplayGroups
} from '@renderer/pages/agents/components/SessionList.helpers'
import {
  createSessionActionContext,
  useSessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/pages/home/Tabs/components/topicContextMenuActions'
import { sortTopicsForDisplayGroups } from '@renderer/pages/home/Tabs/components/Topics.helpers'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { ResourceEditDialogHost, type ResourceEditDialogTarget } from '@renderer/pages/library/dialogs'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic as RendererTopic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { ArrowLeft, Bot, Folder } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import HistoryQueryForm from './components/HistoryQueryForm'
import HistoryResultList from './components/HistoryResultList'
import HistorySourceSidebar, {
  type HistorySourceItem,
  type HistorySourceStatus,
  type HistoryStatusItem
} from './components/HistorySourceSidebar'

export type HistoryRecordsMode = 'assistant' | 'agent'

const ALL_SOURCE_ID = 'all'
const UNLINKED_ASSISTANT_SOURCE_ID = '__unlinked_assistant__'
const NO_WORKDIR_SOURCE_ID = '__no_workdir__'
const WORKDIR_SOURCE_ID_PREFIX = 'workdir:'
const EMPTY_ASSISTANT_BY_ID: ReadonlyMap<string, Assistant> = new Map()
const EMPTY_AGENT_BY_ID: ReadonlyMap<string, AgentEntity> = new Map()
const logger = loggerService.withContext('HistoryRecordsPage')
type AgentHistorySessionStatus = Exclude<HistorySourceStatus, 'all'>
type HistoryTopicItem = ApiTopic & {
  assistantId: string | undefined
  pinned: boolean
}

interface HistoryRecordsPageBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  origin?: DOMRectReadOnly
  onClose: () => void
}

type HistoryRecordsPageProps =
  | (HistoryRecordsPageBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic) => void
    })
  | (HistoryRecordsPageBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string | null) => void
    })

const HistoryRecordsPage = (props: HistoryRecordsPageProps) => {
  const { mode, open } = props
  const portalRootId = mode === 'assistant' ? 'home-page' : 'agent-page'
  const portalRoot = document.getElementById(portalRootId)

  if (!portalRoot || !open) return null

  return createPortal(
    <div className="absolute inset-0 z-40 flex bg-card [-webkit-app-region:none]" data-testid="history-records-page">
      {props.mode === 'assistant' ? (
        <HistoryRecordsContent
          mode="assistant"
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      ) : (
        <HistoryRecordsContent
          mode="agent"
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      )}
    </div>,
    portalRoot
  )
}

type HistoryRecordsContentProps =
  | {
      mode: 'assistant'
      activeRecordId?: string | null
      onClose: () => void
      onRecordSelect?: (topic: RendererTopic) => void
    }
  | {
      mode: 'agent'
      activeRecordId?: string | null
      onClose: () => void
      onRecordSelect?: (sessionId: string | null) => void
    }

const HistoryRecordsContent = (props: HistoryRecordsContentProps) => {
  if (props.mode === 'assistant') {
    return (
      <AssistantHistoryRecordsContent
        activeRecordId={props.activeRecordId}
        onClose={props.onClose}
        onRecordSelect={props.onRecordSelect}
      />
    )
  }

  return (
    <AgentHistoryRecordsContent
      activeRecordId={props.activeRecordId}
      onClose={props.onClose}
      onRecordSelect={props.onRecordSelect}
    />
  )
}

interface AssistantHistoryRecordsContentProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (topic: RendererTopic) => void
}

interface AgentHistoryRecordsContentProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (sessionId: string | null) => void
}

const AssistantHistoryRecordsContent = ({
  activeRecordId,
  onClose,
  onRecordSelect
}: AssistantHistoryRecordsContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')
  const [groupNow] = useState(() => new Date())
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const { topics: rawTopics, isLoading: isTopicsLoading } = useTopics({ loadAll: true })
  const { assistants, refetch: refetchAssistants } = useAssistants()
  const [renamingTopics] = useCache('topic.renaming')
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById } = useTopicMutations()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notes: 'data.export.menus.notes',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })
  const { pinnedIds: topicPinnedIds, togglePin: toggleTopicPin } = usePins('topic')
  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const isTopicPinned = useCallback((topicId: string) => topicPinnedIdSet.has(topicId), [topicPinnedIdSet])
  const renamingTopicIdSet = useMemo(
    () => new Set(Array.isArray(renamingTopics) ? renamingTopics : []),
    [renamingTopics]
  )
  const isTopicRenaming = useCallback((topicId: string) => renamingTopicIdSet.has(topicId), [renamingTopicIdSet])
  const topics = useMemo(
    (): HistoryTopicItem[] =>
      rawTopics.map((topic) => ({
        ...topic,
        assistantId: topic.assistantId,
        pinned: isTopicPinned(topic.id)
      })),
    [isTopicPinned, rawTopics]
  )

  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const assistantRankById = useMemo(
    () => new Map(assistants.map((assistant, index) => [assistant.id, index])),
    [assistants]
  )
  const unlinkedAssistantLabel = t('history.records.sidebar.unknownAssistant', '未关联助手')
  const timeSortedTopics = useMemo(
    () => sortTopicsForDisplayGroups(topics, { mode: 'time', now: groupNow }),
    [groupNow, topics]
  )
  const assistantSortedTopics = useMemo(
    () =>
      sortTopicsForDisplayGroups(topics, {
        assistantRankById,
        mode: 'assistant',
        now: groupNow
      }),
    [assistantRankById, groupNow, topics]
  )
  const rendererTopicById = useMemo(
    () =>
      new Map(
        topics.map((topic) => [
          topic.id,
          {
            ...mapApiTopicToRendererTopic(topic),
            pinned: isTopicPinned(topic.id)
          }
        ])
      ),
    [isTopicPinned, topics]
  )
  const getRendererTopic = useCallback(
    (topic: ApiTopic): RendererTopic =>
      rendererTopicById.get(topic.id) ?? {
        ...mapApiTopicToRendererTopic(topic),
        pinned: isTopicPinned(topic.id)
      },
    [isTopicPinned, rendererTopicById]
  )

  const assistantSources = useMemo(
    () => buildAssistantSources(topics, assistantById, assistantRankById, unlinkedAssistantLabel, t),
    [assistantById, assistantRankById, t, topics, unlinkedAssistantLabel]
  )

  const filteredTopics = useMemo(() => {
    const sortedTopics = selectedSourceId === ALL_SOURCE_ID ? timeSortedTopics : assistantSortedTopics
    if (selectedSourceId === ALL_SOURCE_ID) return sortedTopics

    return sortedTopics.filter((topic) => getTopicSourceId(topic, assistantById) === selectedSourceId)
  }, [assistantById, assistantSortedTopics, selectedSourceId, timeSortedTopics])

  const searchedTopics = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredTopics

    return filteredTopics.filter((topic) => {
      const topicName = topic.name || t('chat.default.topic.name', '新话题')
      return topicName.toLowerCase().includes(keywords)
    })
  }, [filteredTopics, searchText, t])

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (assistantSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [assistantSources, selectedSourceId])

  const handleTopicSelect = useCallback(
    (topic: ApiTopic) => {
      onRecordSelect?.(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [onClose, onRecordSelect, rendererTopicById]
  )

  const updateTopic = useCallback(
    (topic: RendererTopic) =>
      patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited
      }),
    [patchTopic]
  )

  const handlePinTopic = useCallback(
    async (topic: Pick<RendererTopic, 'id'>) => {
      try {
        await toggleTopicPin(topic.id)
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
      }
    },
    [toggleTopicPin]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: RendererTopic) => {
      try {
        await deleteTopicById(topic.id)
      } catch (err) {
        logger.error('Failed to delete topic from history records', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }

      if (topic.id === activeRecordId && timeSortedTopics.length > 1) {
        const nextTopic = findAdjacentHistoryRecord(timeSortedTopics, topic.id, (candidate) => candidate.id)
        if (nextTopic) {
          onRecordSelect?.(getRendererTopic(nextTopic))
        }
      }
    },
    [activeRecordId, deleteTopicById, getRendererTopic, onRecordSelect, t, timeSortedTopics]
  )

  const handleClearMessages = useCallback((topic: RendererTopic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleAutoRename = useCallback(
    async (topic: RendererTopic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (summaryError) {
          window.toast?.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic]
  )

  const handleRenameTopic = useCallback(
    (topicId: string, name: string) => {
      const topic = rendererTopicById.get(topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      void updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
      window.toast.success(t('common.saved'))
    },
    [rendererTopicById, t, updateTopic]
  )
  const handleEditAssistant = useCallback((topic: RendererTopic) => {
    if (topic.assistantId) {
      setEditDialogTarget({ kind: 'assistant', id: topic.assistantId })
    }
  }, [])

  const getTopicActionContext = useCallback(
    (apiTopic: ApiTopic): TopicActionContext => {
      const topic = getRendererTopic(apiTopic)

      return createTopicActionContext({
        exportMenuOptions: exportMenuOptions as TopicExportMenuOptions,
        isRenaming: isTopicRenaming(topic.id),
        onAutoRename: handleAutoRename,
        onClearMessages: handleClearMessages,
        onDelete: handleDeleteTopicFromMenu,
        onEditAssistant: handleEditAssistant,
        onPinTopic: handlePinTopic,
        onStartRename: () => undefined,
        notesPath,
        t,
        topic,
        topicsLength: topics.length
      })
    },
    [
      exportMenuOptions,
      getRendererTopic,
      handleAutoRename,
      handleClearMessages,
      handleDeleteTopicFromMenu,
      handleEditAssistant,
      handlePinTopic,
      isTopicRenaming,
      notesPath,
      t,
      topics.length
    ]
  )

  const topicMenuPreset = useTopicMenuPreset<ApiTopic>({ getActionContext: getTopicActionContext })

  return (
    <HistoryRecordsLayout
      mode="assistant"
      onClose={onClose}
      sources={assistantSources}
      selectedSourceId={selectedSourceId}
      subtitle={t('history.records.assistantSubtitle', '{{count}} 个话题', { count: topics.length })}
      resultCount={searchedTopics.length}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}>
      <HistoryResultList
        mode="assistant"
        topics={searchedTopics}
        sessions={[]}
        assistantById={assistantById}
        agentById={EMPTY_AGENT_BY_ID}
        unlinkedAssistantLabel={unlinkedAssistantLabel}
        isLoading={isTopicsLoading}
        isTopicPinned={isTopicPinned}
        onToggleTopicPin={handlePinTopic}
        topicMenuPreset={topicMenuPreset}
        onTopicRename={handleRenameTopic}
        onTopicSelect={handleTopicSelect}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
        onSaved={refetchAssistants}
      />
    </HistoryRecordsLayout>
  )
}

const AgentHistoryRecordsContent = ({ activeRecordId, onClose, onRecordSelect }: AgentHistoryRecordsContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')
  const [groupNow] = useState(() => new Date())
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)

  const {
    sessions,
    pinIdBySessionId,
    isLoading: isSessionsLoading,
    deleteSession,
    togglePin
  } = useSessions(undefined, {
    loadAll: true,
    pageSize: 50
  })
  const { data: workspaces } = useQuery('/workspaces')
  const { agents, refetch: refetchAgents } = useAgents()
  const isSessionPinned = useCallback((sessionId: string) => pinIdBySessionId.has(sessionId), [pinIdBySessionId])
  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: isSessionPinned(session.id) })),
    [isSessionPinned, sessions]
  )
  const workdirDisplay = useMemo(
    () => createSessionWorkdirDisplayMaps(sessionItems, workspaces ?? []),
    [sessionItems, workspaces]
  )
  const timeSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { mode: 'time', now: groupNow }),
    [groupNow, sessionItems]
  )
  const workdirSortedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        mode: 'workdir',
        now: groupNow,
        workdirDisplay
      }),
    [groupNow, sessionItems, workdirDisplay]
  )
  const sessionIds = useMemo(() => sessionItems.map((session) => session.id), [sessionItems])
  const streamStatusBySessionId = useAgentSessionStreamStatuses(sessionIds)

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const noWorkdirLabel = t('agent.session.group.no_workdir')
  const statusItems = useMemo(
    () => buildAgentStatusItems(sessions, streamStatusBySessionId, t),
    [sessions, streamStatusBySessionId, t]
  )
  const workdirSources = useMemo(
    () => buildWorkdirSources(sessionItems, workdirDisplay, noWorkdirLabel, t),
    [noWorkdirLabel, sessionItems, t, workdirDisplay]
  )

  const statusFilteredSessions = useMemo(() => {
    const sortedSessions = selectedSourceId === ALL_SOURCE_ID ? timeSortedSessions : workdirSortedSessions
    if (selectedStatus === ALL_SOURCE_ID) return sortedSessions

    return sortedSessions.filter(
      (session) => getAgentHistoryStatus(streamStatusBySessionId.get(session.id)) === selectedStatus
    )
  }, [selectedSourceId, selectedStatus, streamStatusBySessionId, timeSortedSessions, workdirSortedSessions])

  const filteredSessions = useMemo(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return statusFilteredSessions

    return statusFilteredSessions.filter((session) => getSessionWorkdirSourceId(session) === selectedSourceId)
  }, [selectedSourceId, statusFilteredSessions])

  const searchedSessions = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredSessions

    return filteredSessions.filter((session) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      const searchFields = [session.name, session.description, agent?.name]

      return searchFields.some((value) => value?.toLowerCase().includes(keywords))
    })
  }, [agentById, filteredSessions, searchText])
  const { updateSession } = useUpdateSession()

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (workdirSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [selectedSourceId, workdirSources])

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      onRecordSelect?.(sessionId)
      onClose()
    },
    [onClose, onRecordSelect]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const success = await deleteSession(id)
      if (success && activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecord(timeSortedSessions, id, (session) => session.id)
        onRecordSelect?.(nextSession?.id ?? null)
      }
    },
    [activeRecordId, deleteSession, onRecordSelect, timeSortedSessions]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessions.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const updatedSession = await updateSession({ id, name: trimmedName }, { showSuccessToast: false })
        if (updatedSession) {
          window.toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session from history records', { err, sessionId: id })
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessions, t, updateSession]
  )
  const handleEditAgent = useCallback((session: AgentSessionEntity) => {
    if (session.agentId) {
      setEditDialogTarget({ kind: 'agent', id: session.agentId })
    }
  }, [])

  const getSessionActionContext = useCallback(
    (session: AgentSessionEntity): SessionActionContext =>
      createSessionActionContext({
        onDelete: () => {
          void handleDeleteSession(session.id)
        },
        onEditAgent: session.agentId ? () => handleEditAgent(session) : undefined,
        onTogglePin: () => {
          void togglePin(session.id)
        },
        pinned: isSessionPinned(session.id),
        sessionName: session.name ?? session.id,
        startEdit: () => undefined,
        t
      }),
    [handleDeleteSession, handleEditAgent, isSessionPinned, t, togglePin]
  )

  const sessionMenuPreset = useSessionMenuPreset<AgentSessionEntity>({ getActionContext: getSessionActionContext })
  const handleToggleSessionPin = useCallback(
    (sessionId: string) => {
      void togglePin(sessionId)
    },
    [togglePin]
  )

  return (
    <HistoryRecordsLayout
      mode="agent"
      onClose={onClose}
      sources={workdirSources}
      selectedSourceId={selectedSourceId}
      selectedStatus={selectedStatus}
      statusItems={statusItems}
      subtitle={t('history.records.agentSubtitle', '{{count}} 个会话', { count: sessions.length })}
      resultCount={searchedSessions.length}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}
      onStatusSelect={setSelectedStatus}>
      <HistoryResultList
        mode="agent"
        topics={[]}
        sessions={searchedSessions}
        assistantById={EMPTY_ASSISTANT_BY_ID}
        agentById={agentById}
        unlinkedAssistantLabel=""
        isLoading={isSessionsLoading}
        isSessionPinned={isSessionPinned}
        onToggleSessionPin={handleToggleSessionPin}
        sessionMenuPreset={sessionMenuPreset}
        onSessionRename={handleRenameSession}
        onSessionSelect={handleSessionSelect}
      />
      <ResourceEditDialogHost
        target={editDialogTarget}
        onOpenChange={(open) => {
          if (!open) setEditDialogTarget(null)
        }}
        onSaved={refetchAgents}
      />
    </HistoryRecordsLayout>
  )
}

interface HistoryRecordsLayoutProps {
  mode: HistoryRecordsMode
  onClose: () => void
  sources: HistorySourceItem[]
  selectedSourceId: string
  selectedStatus?: HistorySourceStatus
  statusItems?: HistoryStatusItem[]
  subtitle: string
  resultCount: number
  searchText: string
  children: ReactNode
  onSearchTextChange: (value: string) => void
  onSourceSelect: (sourceId: string) => void
  onStatusSelect?: (status: HistorySourceStatus) => void
}

const HistoryRecordsLayout = ({
  mode,
  onClose,
  sources,
  selectedSourceId,
  selectedStatus,
  statusItems,
  subtitle,
  resultCount,
  searchText,
  children,
  onSearchTextChange,
  onSourceSelect,
  onStatusSelect
}: HistoryRecordsLayoutProps) => {
  const { t } = useTranslation()
  const title = t('history.records.shortTitle', '历史记录')

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card pb-3 text-foreground" aria-label={title}>
      <header className="flex h-[52px] shrink-0 items-center bg-card px-3 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 min-h-7 shrink-0 rounded-md text-foreground-muted shadow-none hover:bg-accent hover:text-foreground"
            aria-label={t('common.back', '返回')}
            onClick={onClose}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate font-semibold text-base text-foreground leading-5">{title}</h2>
            <span className="truncate text-foreground-muted text-xs leading-4">{subtitle}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <HistorySourceSidebar
          mode={mode}
          sources={sources}
          selectedSourceId={selectedSourceId}
          selectedStatus={selectedStatus}
          statusItems={statusItems}
          onSourceSelect={onSourceSelect}
          onStatusSelect={onStatusSelect}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <HistoryQueryForm
            mode={mode}
            resultCount={resultCount}
            searchText={searchText}
            onSearchTextChange={onSearchTextChange}
          />
          {children}
        </main>
      </div>
    </section>
  )
}

function getTopicSourceId(topic: Pick<ApiTopic, 'assistantId'>, assistantById?: ReadonlyMap<string, Assistant>) {
  if (!topic.assistantId) return UNLINKED_ASSISTANT_SOURCE_ID
  if (assistantById && !assistantById.has(topic.assistantId)) return UNLINKED_ASSISTANT_SOURCE_ID

  return topic.assistantId
}

function getSessionWorkdirSourceId(session: Pick<AgentSessionEntity, 'workspace' | 'workspaceId'>) {
  const path = getPrimarySessionWorkdir(session)
  return path ? `${WORKDIR_SOURCE_ID_PREFIX}${encodeURIComponent(path)}` : NO_WORKDIR_SOURCE_ID
}

function getWorkdirSourcePath(sourceId: string) {
  if (!sourceId.startsWith(WORKDIR_SOURCE_ID_PREFIX)) return null
  return decodeURIComponent(sourceId.slice(WORKDIR_SOURCE_ID_PREFIX.length))
}

function getAgentHistoryStatus(streamStatus?: AgentSessionStreamState): AgentHistorySessionStatus {
  if (streamStatus?.isPending === true) return 'running'
  if (streamStatus?.status === 'error') return 'failed'

  return 'completed'
}

function findAdjacentHistoryRecord<T>(
  items: readonly T[],
  deletedId: string,
  getId: (item: T) => string
): T | undefined {
  const index = items.findIndex((item) => getId(item) === deletedId)
  if (index < 0) return undefined

  return items[index + 1 === items.length ? index - 1 : index + 1]
}

function buildAgentStatusItems(
  sessions: readonly AgentSessionEntity[],
  streamStatusBySessionId: ReadonlyMap<string, AgentSessionStreamState>,
  t: ReturnType<typeof useTranslation>['t']
): HistoryStatusItem[] {
  const counts: Record<AgentHistorySessionStatus, number> = {
    running: 0,
    completed: 0,
    failed: 0
  }

  for (const session of sessions) {
    counts[getAgentHistoryStatus(streamStatusBySessionId.get(session.id))] += 1
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: sessions.length
    },
    {
      id: 'running',
      label: t('history.records.status.running', '运行中'),
      count: counts.running,
      dotClassName: 'text-warning'
    },
    {
      id: 'completed',
      label: t('history.records.status.completed', '已完成'),
      count: counts.completed,
      dotClassName: 'text-success'
    },
    {
      id: 'failed',
      label: t('history.records.status.failed', '失败'),
      count: counts.failed,
      dotClassName: 'text-destructive'
    }
  ]
}

function buildAssistantSources(
  topics: readonly ApiTopic[],
  assistantById: ReadonlyMap<string, Assistant>,
  assistantRankById: ReadonlyMap<string, number>,
  unlinkedAssistantLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): HistorySourceItem[] {
  const counts = new Map<string, number>()

  for (const topic of topics) {
    const sourceId = getTopicSourceId(topic, assistantById)
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: topics.length
    },
    ...Array.from(counts.entries())
      .sort(
        ([leftId], [rightId]) =>
          getAssistantSourceRank(leftId, assistantRankById) - getAssistantSourceRank(rightId, assistantRankById)
      )
      .map(([sourceId, count]) => {
        const assistant = sourceId === UNLINKED_ASSISTANT_SOURCE_ID ? undefined : assistantById.get(sourceId)

        return {
          id: sourceId,
          label: assistant?.name ?? unlinkedAssistantLabel,
          count,
          icon: assistant?.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={15} />
        }
      })
  ]
}

function getAssistantSourceRank(sourceId: string, assistantRankById: ReadonlyMap<string, number>) {
  const assistantRank = assistantRankById.get(sourceId)
  if (assistantRank !== undefined) return assistantRank

  return Number.MAX_SAFE_INTEGER
}

function buildWorkdirSources(
  sessions: readonly AgentSessionEntity[],
  workdirDisplay: SessionWorkdirDisplayMaps,
  noWorkdirLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): HistorySourceItem[] {
  const counts = new Map<string, number>()

  for (const session of sessions) {
    const sourceId = getSessionWorkdirSourceId(session)
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: sessions.length
    },
    ...Array.from(counts.entries())
      .sort(
        ([leftId], [rightId]) =>
          getWorkdirSourceRank(leftId, workdirDisplay) - getWorkdirSourceRank(rightId, workdirDisplay)
      )
      .map(([sourceId, count]) => ({
        id: sourceId,
        label: getWorkdirSourceLabel(sourceId, workdirDisplay, noWorkdirLabel),
        count,
        icon: <Folder size={15} />
      }))
  ]
}

function getWorkdirSourceRank(sourceId: string, workdirDisplay: SessionWorkdirDisplayMaps) {
  if (sourceId === NO_WORKDIR_SOURCE_ID) return Number.MAX_SAFE_INTEGER
  const path = getWorkdirSourcePath(sourceId)
  const groupId = path ? workdirDisplay.groupIdByPath.get(path) : undefined
  return groupId ? (workdirDisplay.rankByGroupId.get(groupId) ?? Number.MAX_SAFE_INTEGER - 1) : Number.MAX_SAFE_INTEGER
}

function getWorkdirSourceLabel(sourceId: string, workdirDisplay: SessionWorkdirDisplayMaps, noWorkdirLabel: string) {
  if (sourceId === NO_WORKDIR_SOURCE_ID) return noWorkdirLabel
  const path = getWorkdirSourcePath(sourceId)
  if (!path) return noWorkdirLabel
  const groupId = workdirDisplay.groupIdByPath.get(path)
  return (groupId ? workdirDisplay.labelByGroupId.get(groupId) : undefined) ?? getSessionWorkdirFallbackLabel(path)
}

export default HistoryRecordsPage
