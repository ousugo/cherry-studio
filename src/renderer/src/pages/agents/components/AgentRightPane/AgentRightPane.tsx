import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '@cherrystudio/ui'
import {
  ARTIFACT_RIGHT_PANE_CACHE_KEY,
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH,
  RightPaneHost
} from '@renderer/components/chat'
import { EmptyState } from '@renderer/components/chat'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import ArtifactPane, { ARTIFACT_PANE_WIDTH } from '@renderer/components/chat/panes/ArtifactPane'
import { RightSidebarCollapseIcon, RightSidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgentMessageListProviderValue } from '@renderer/pages/agents/messages/agentMessageListAdapter'
import type { Topic, TopicType as TopicTypeEnum } from '@renderer/types'
import { TopicType } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { Activity, CheckCircle, Circle, FolderOpen, GitBranch, Loader2, Wrench, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentRightPaneStatus,
  type AgentRightPaneTab,
  type AgentStatusTask,
  type AgentToolFlowOpenInput,
  buildAgentRightPaneStatus,
  buildAgentToolFlowProjection
} from './agentRightPaneProjection'

interface AgentRightPaneState {
  open: boolean
  maximized: boolean
  overlayBottomInset: number
  activeTab: AgentRightPaneTab
  flowTabs: AgentRightPaneFlowTab[]
  activeFlowTab?: AgentRightPaneFlowTab
  selectedToolCallId?: string
  selectedToolName?: string
  workspacePath?: string
  selectedFile: string | null
  flow: ReturnType<typeof buildAgentToolFlowProjection>
  status: AgentRightPaneStatus
}

interface AgentRightPaneActions {
  close: () => void
  openTab: (tab: AgentRightPaneTab) => void
  toggleFiles: () => void
  toggleMaximized: () => void
  setOverlayBottomInset: (inset: number) => void
  setSelectedFile: (file: string | null) => void
  openAgentToolFlow: (input: AgentToolFlowOpenInput) => void
}

interface AgentRightPaneMeta {
  sessionId?: string
  sessionName?: string
  agentId?: string
  agentName?: string
  agentAvatar?: string
  modelFallback?: ModelSnapshot
}

interface AgentRightPaneContextValue {
  state: AgentRightPaneState
  actions: AgentRightPaneActions
  meta: AgentRightPaneMeta
}

interface AgentRightPaneProviderProps extends AgentRightPaneMeta {
  children: ReactNode
  workspacePath?: string
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}

interface AgentRightPaneFlowTab {
  toolCallId: string
  toolName?: string
  sourceMessageId?: string
  title: string
}

const AgentRightPaneContext = createContext<AgentRightPaneContextValue | null>(null)
const FLOW_TAB_PREFIX = 'flow:'
const MAX_FLOW_TAB_TITLE_LENGTH = 32

function getFlowTabValue(toolCallId: string): AgentRightPaneTab {
  return `${FLOW_TAB_PREFIX}${toolCallId}` as AgentRightPaneTab
}

function getFlowToolCallId(tab: AgentRightPaneTab): string | undefined {
  return tab.startsWith(FLOW_TAB_PREFIX) ? tab.slice(FLOW_TAB_PREFIX.length) : undefined
}

function getFlowTabTitle(input: AgentToolFlowOpenInput): string {
  const title = input.title?.trim() || input.toolName?.trim() || input.toolCallId
  return title.length > MAX_FLOW_TAB_TITLE_LENGTH ? `${title.slice(0, MAX_FLOW_TAB_TITLE_LENGTH - 3)}...` : title
}

function useAgentRightPane(): AgentRightPaneContextValue {
  const value = use(AgentRightPaneContext)
  if (!value) throw new Error('useAgentRightPane must be used within AgentRightPane.Provider')
  return value
}

export function useAgentRightPaneActions(): AgentRightPaneActions {
  return useAgentRightPane().actions
}

function AgentRightPaneProvider({
  children,
  workspacePath,
  messages,
  partsByMessageId,
  sessionId,
  sessionName,
  agentId,
  agentName,
  agentAvatar,
  modelFallback
}: AgentRightPaneProviderProps) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [overlayBottomInset, setOverlayBottomInset] = useState(0)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AgentRightPaneTab>('files')
  const [flowTabs, setFlowTabs] = useState<AgentRightPaneFlowTab[]>([])
  const activeFlowToolCallId = getFlowToolCallId(activeTab)
  const activeFlowTab = activeFlowToolCallId
    ? flowTabs.find((flowTab) => flowTab.toolCallId === activeFlowToolCallId)
    : undefined

  const flow = useMemo(
    () => buildAgentToolFlowProjection(messages, partsByMessageId, activeFlowTab?.toolCallId),
    [activeFlowTab?.toolCallId, messages, partsByMessageId]
  )
  const status = useMemo(() => buildAgentRightPaneStatus(messages, partsByMessageId), [messages, partsByMessageId])

  useEffect(() => {
    setSelectedFile(null)
  }, [workspacePath])

  const close = useCallback(() => {
    setOpen(false)
    setMaximized(false)
    setActiveTab('files')
  }, [])
  const openTab = useCallback(
    (tab: AgentRightPaneTab) => {
      const flowToolCallId = getFlowToolCallId(tab)
      if (flowToolCallId && !flowTabs.some((flowTab) => flowTab.toolCallId === flowToolCallId)) return
      setActiveTab(tab)
      setOpen(true)
    },
    [flowTabs]
  )
  const toggleFiles = useCallback(() => {
    setOpen((currentOpen) => {
      if (currentOpen && activeTab === 'files') {
        setMaximized(false)
        return false
      }
      setActiveTab('files')
      return true
    })
  }, [activeTab])
  const toggleMaximized = useCallback(() => {
    setMaximized((currentMaximized) => !currentMaximized)
  }, [])
  const openAgentToolFlow = useCallback((input: AgentToolFlowOpenInput) => {
    const nextTab = {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      sourceMessageId: input.sourceMessageId,
      title: getFlowTabTitle(input)
    }
    setFlowTabs((currentTabs) => {
      if (!currentTabs.some((tab) => tab.toolCallId === input.toolCallId)) return [...currentTabs, nextTab]
      return currentTabs.map((tab) => (tab.toolCallId === input.toolCallId ? { ...tab, ...nextTab } : tab))
    })
    setActiveTab(getFlowTabValue(input.toolCallId))
    setOpen(true)
  }, [])

  const value = useMemo<AgentRightPaneContextValue>(
    () => ({
      state: {
        open,
        maximized,
        overlayBottomInset,
        activeTab,
        flowTabs,
        activeFlowTab,
        selectedToolCallId: activeFlowTab?.toolCallId,
        selectedToolName: activeFlowTab?.toolName,
        workspacePath,
        selectedFile,
        flow,
        status
      },
      actions: {
        close,
        openTab,
        toggleFiles,
        toggleMaximized,
        setOverlayBottomInset,
        setSelectedFile,
        openAgentToolFlow
      },
      meta: {
        sessionId,
        sessionName,
        agentId,
        agentName,
        agentAvatar,
        modelFallback
      }
    }),
    [
      activeTab,
      agentAvatar,
      agentId,
      agentName,
      close,
      flow,
      flowTabs,
      activeFlowTab,
      maximized,
      modelFallback,
      open,
      openAgentToolFlow,
      openTab,
      overlayBottomInset,
      selectedFile,
      sessionId,
      sessionName,
      status,
      toggleFiles,
      toggleMaximized,
      workspacePath
    ]
  )

  return <AgentRightPaneContext value={value}>{children}</AgentRightPaneContext>
}

function AgentRightPaneHost() {
  const { state } = useAgentRightPane()

  return (
    <RightPaneHost
      open={state.open && !state.maximized}
      width={ARTIFACT_PANE_WIDTH}
      resizable
      minWidth={ARTIFACT_RIGHT_PANE_MIN_WIDTH}
      defaultWidth={ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH}
      maxWidth={ARTIFACT_RIGHT_PANE_MAX_WIDTH}
      cacheKey={ARTIFACT_RIGHT_PANE_CACHE_KEY}>
      <AgentRightPaneShell />
    </RightPaneHost>
  )
}

function AgentRightPaneMaximizedOverlay() {
  const { state } = useAgentRightPane()
  if (!state.open || !state.maximized) return null

  return (
    <div
      className="absolute inset-x-0 top-0 z-40 min-h-0 overflow-hidden bg-background p-4"
      style={{ bottom: state.overlayBottomInset }}>
      <AgentRightPaneShell />
    </div>
  )
}

function AgentRightPaneShell() {
  const { state, actions } = useAgentRightPane()
  const { t } = useTranslation()
  const incompleteTasks = state.status.tasks.filter((task) => task.status !== 'completed').length

  return (
    <Tabs
      value={state.activeTab}
      onValueChange={(value) => actions.openTab(value as AgentRightPaneTab)}
      variant="line"
      className="h-full gap-0 overflow-hidden bg-card text-card-foreground">
      <div className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b px-3">
        <TabsList className="min-w-0 flex-1 justify-start gap-2 overflow-x-auto">
          <TabsTrigger value="files" className="shrink-0 gap-1.5 px-1.5 py-2 text-xs">
            <FolderOpen size={14} />
            {t('agent.right_pane.tabs.files')}
          </TabsTrigger>
          {state.flowTabs.map((flowTab) => (
            <TabsTrigger
              key={flowTab.toolCallId}
              value={getFlowTabValue(flowTab.toolCallId)}
              className="max-w-40 shrink-0 gap-1.5 px-1.5 py-2 text-xs">
              <GitBranch size={14} />
              <span className="min-w-0 truncate">{flowTab.title}</span>
            </TabsTrigger>
          ))}
          <TabsTrigger value="status" className="shrink-0 gap-1.5 px-1.5 py-2 text-xs">
            <Activity size={14} />
            {t('agent.right_pane.tabs.status')}
            {incompleteTasks > 0 && (
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-3">
                {incompleteTasks}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <Tooltip content={t('agent.right_pane.close')} delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('agent.right_pane.close')}
            onClick={actions.close}>
            <X size={15} />
          </Button>
        </Tooltip>
      </div>
      <TabsContent value="files" className="min-h-0 overflow-hidden">
        <AgentRightPaneFilesTab />
      </TabsContent>
      {state.flowTabs.map((flowTab) => {
        const tabValue = getFlowTabValue(flowTab.toolCallId)
        return (
          <TabsContent key={flowTab.toolCallId} value={tabValue} className="min-h-0 overflow-hidden">
            {state.activeTab === tabValue ? <AgentRightPaneFlowTab tab={flowTab} /> : null}
          </TabsContent>
        )
      })}
      <TabsContent value="status" className="min-h-0 overflow-auto">
        <AgentRightPaneStatusTab />
      </TabsContent>
    </Tabs>
  )
}

function AgentRightPaneFilesTab() {
  const { state, actions } = useAgentRightPane()
  return (
    <ArtifactPane
      workspacePath={state.workspacePath}
      maximized={state.maximized}
      selectedFile={state.selectedFile}
      onSelectedFileChange={actions.setSelectedFile}
      onToggleMaximized={actions.toggleMaximized}
    />
  )
}

function AgentToolFlowMessageList({
  messages,
  partsByMessageId
}: {
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
}) {
  const { actions, meta } = useAgentRightPane()
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const topic = useMemo<Topic>(
    () => ({
      id: meta.sessionId ? buildAgentSessionTopicId(meta.sessionId) : 'agent-session:tool-flow',
      type: TopicType.Session as TopicTypeEnum,
      assistantId: meta.agentId,
      name: meta.sessionName ?? meta.sessionId ?? 'agent-tool-flow',
      createdAt: FALLBACK_TIMESTAMP,
      updatedAt: FALLBACK_TIMESTAMP,
      messages: []
    }),
    [meta.agentId, meta.sessionId, meta.sessionName]
  )
  const providerValue = useAgentMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    assistantProfile: meta.agentName
      ? {
          name: meta.agentName,
          avatar: meta.agentAvatar
        }
      : undefined,
    assistantId: meta.agentId,
    modelFallback: meta.modelFallback,
    isLoading: false,
    hasOlder: false,
    openAgentToolFlow: actions.openAgentToolFlow,
    messageNavigation
  })
  const flowProviderValue = useMemo(
    () => ({
      ...providerValue,
      state: {
        ...providerValue.state,
        selection: undefined,
        renderConfig: {
          ...providerValue.state.renderConfig,
          collapseCompletedToolHistory: false
        }
      }
    }),
    [providerValue]
  )

  return (
    <MessageListProvider value={flowProviderValue}>
      <div className="h-full min-h-0 [&_.MessageFooter]:hidden [&_.group-menu-bar]:hidden">
        <MessageList />
      </div>
    </MessageListProvider>
  )
}

function AgentRightPaneFlowTab({ tab }: { tab?: AgentRightPaneFlowTab }) {
  const { state } = useAgentRightPane()
  const { t } = useTranslation()
  const activeTab = tab ?? state.activeFlowTab

  if (!activeTab) {
    return (
      <EmptyState
        icon={Wrench}
        title={t('agent.right_pane.flow.empty.title')}
        description={t('agent.right_pane.flow.empty.description')}
      />
    )
  }

  if (!state.flow.messages.length) {
    return (
      <EmptyState
        icon={GitBranch}
        title={activeTab.title || t('agent.right_pane.flow.no_messages.title')}
        description={t('agent.right_pane.flow.no_messages.description')}
      />
    )
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <AgentToolFlowMessageList messages={state.flow.messages} partsByMessageId={state.flow.partsByMessageId} />
    </div>
  )
}

function TaskStatusIcon({ status }: { status: AgentStatusTask['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={14} className="text-success" />
    case 'in_progress':
      return <Loader2 size={14} className="animate-spin text-info" />
    case 'error':
      return <Circle size={14} className="text-destructive" />
    case 'pending':
    default:
      return <Circle size={14} className="text-muted-foreground" />
  }
}

function AgentRightPaneStatusTab() {
  const { state, meta } = useAgentRightPane()
  const { t } = useTranslation()
  const { status } = state

  return (
    <div className="space-y-4 p-3 text-sm">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.tasks')}</h3>
          <Badge variant="outline" className="text-[11px]">
            {t('agent.right_pane.status.task_count', {
              completed: status.completedTaskCount,
              total: status.totalTaskCount
            })}
          </Badge>
        </div>
        {status.tasks.length ? (
          <div className="space-y-1.5">
            {status.tasks.map((task) => (
              <div
                key={`${task.source}-${task.id}`}
                className="flex items-start gap-2 rounded-md border border-border-subtle bg-background-subtle px-2.5 py-2">
                <TaskStatusIcon status={task.status} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'wrap-break-word text-foreground text-xs leading-5',
                      task.status === 'completed' && 'text-muted-foreground line-through'
                    )}>
                    {task.status === 'in_progress' && task.activeText ? task.activeText : task.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border-subtle px-3 py-2 text-muted-foreground text-xs">
            {t('agent.right_pane.status.no_tasks')}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.context')}</h3>
        <dl className="space-y-2 rounded-md border border-border-subtle px-3 py-2 text-xs">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.workspace')}</dt>
            <dd className="break-all text-foreground">{state.workspacePath || t('common.none')}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.agent')}</dt>
            <dd className="break-all text-foreground">{meta.agentName || meta.agentId || t('common.none')}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground">{t('agent.right_pane.status.selected_tool')}</dt>
            <dd className="break-all text-foreground">
              {state.activeFlowTab?.title ||
                state.flow.selectedTool?.toolName ||
                state.selectedToolName ||
                t('common.none')}
            </dd>
          </div>
        </dl>
        {status.latestCompactSummary && (
          <div className="max-h-40 overflow-auto rounded-md border border-border-subtle px-3 py-2 text-foreground text-xs leading-5">
            {status.latestCompactSummary}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium text-foreground text-sm">{t('agent.right_pane.status.activity')}</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <StatusMetric label={t('agent.right_pane.status.tools_total')} value={status.toolStats.total} />
          <StatusMetric label={t('agent.right_pane.status.tools_active')} value={status.toolStats.active} />
          <StatusMetric label={t('agent.right_pane.status.tools_done')} value={status.toolStats.completed} />
          <StatusMetric label={t('agent.right_pane.status.tools_failed')} value={status.toolStats.failed} />
        </div>
      </section>
    </div>
  )
}

function StatusMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border-subtle px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground text-lg leading-6">{value}</div>
    </div>
  )
}

function AgentRightPaneFilesToggle() {
  const { state, actions } = useAgentRightPane()
  const { t } = useTranslation()
  const pressed = state.open && state.activeTab === 'files'

  return (
    <Tooltip content={t('agent.right_pane.files_toggle')} delay={800}>
      <NavbarIcon
        onClick={actions.toggleFiles}
        aria-pressed={pressed}
        aria-label={t('agent.right_pane.files_toggle')}
        data-state={pressed ? 'open' : 'closed'}>
        {pressed ? <RightSidebarCollapseIcon /> : <RightSidebarExpandIcon />}
      </NavbarIcon>
    </Tooltip>
  )
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export const AgentRightPane = {
  Provider: AgentRightPaneProvider,
  Host: AgentRightPaneHost,
  MaximizedOverlay: AgentRightPaneMaximizedOverlay,
  Shell: AgentRightPaneShell,
  FilesTab: AgentRightPaneFilesTab,
  FlowTab: AgentRightPaneFlowTab,
  StatusTab: AgentRightPaneStatusTab,
  FilesToggle: AgentRightPaneFilesToggle
}
