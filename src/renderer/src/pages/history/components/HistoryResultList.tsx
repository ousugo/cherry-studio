import { EmptyState } from '@cherrystudio/ui'
import { ResourceList, useResourceList } from '@renderer/components/chat/resources'
import EditNameDialog from '@renderer/components/EditNameDialog'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type {
  SessionMenuActionContextOverride,
  SessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
import type {
  TopicMenuActionContextOverride,
  TopicMenuPreset
} from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import dayjs from 'dayjs'
import { Bot, MessageSquareText, PinIcon, Wrench } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HISTORY_HEADER_GRID_CLASS =
  'grid min-w-[760px] grid-cols-[minmax(320px,1fr)_160px_92px] gap-3 px-5 py-2.5 font-medium text-foreground-muted text-xs leading-4'
const HISTORY_ROW_GRID_CLASS =
  'grid w-full min-w-[736px] grid-cols-[minmax(320px,1fr)_160px_92px] items-center gap-3 rounded-md px-3 text-sm leading-5'
const TopicHistoryResourceProvider = ResourceList.Provider<Topic>
const SessionHistoryResourceProvider = ResourceList.Provider<AgentSessionEntity>

interface HistoryResultListProps {
  mode: HistoryRecordsMode
  topics: readonly Topic[]
  sessions: readonly AgentSessionEntity[]
  assistantById: ReadonlyMap<string, Assistant>
  agentById: ReadonlyMap<string, AgentEntity>
  unlinkedAssistantLabel: string
  isLoading?: boolean
  isSessionPinned?: (sessionId: string) => boolean
  isTopicPinned?: (topicId: string) => boolean
  onToggleSessionPin?: (sessionId: string) => void | Promise<void>
  onToggleTopicPin?: (topic: Topic) => void | Promise<void>
  topicMenuPreset?: TopicMenuPreset<Topic>
  sessionMenuPreset?: SessionMenuPreset<AgentSessionEntity>
  onTopicRename?: (id: string, name: string) => void | Promise<void>
  onSessionRename?: (id: string, name: string) => void | Promise<void>
  onTopicSelect?: (topic: Topic) => void
  onSessionSelect?: (sessionId: string) => void
}

const HistoryResultList = ({
  mode,
  topics,
  sessions,
  assistantById,
  agentById,
  unlinkedAssistantLabel,
  isLoading = false,
  isSessionPinned = () => false,
  isTopicPinned = () => false,
  onToggleSessionPin,
  onToggleTopicPin,
  topicMenuPreset,
  sessionMenuPreset,
  onTopicRename,
  onSessionRename,
  onTopicSelect,
  onSessionSelect
}: HistoryResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const sessionList = useMemo(() => Array.from(sessions), [sessions])
  const itemCount = mode === 'assistant' ? topicList.length : sessionList.length
  const handleTopicRename = useCallback((id: string, name: string) => void onTopicRename?.(id, name), [onTopicRename])
  const handleSessionRename = useCallback(
    (id: string, name: string) => void onSessionRename?.(id, name),
    [onSessionRename]
  )
  const emptyTitle = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.title', '正在加载话题')
      : t('history.records.loading.sessionsTitle', '正在加载会话')
    : mode === 'assistant'
      ? t('history.records.empty.title', '暂无话题')
      : t('history.records.empty.sessionsTitle', '暂无会话')
  const emptyDescription = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.description', '正在读取话题列表。')
      : t('history.records.loading.sessionsDescription', '正在读取会话列表。')
    : mode === 'assistant'
      ? t('history.records.empty.description', '当前筛选下没有可展示的话题。')
      : t('history.records.empty.sessionsDescription', '当前筛选下没有可展示的会话。')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:h-1.5">
        <div className="flex min-h-0 min-w-[760px] flex-1 flex-col">
          <HistoryListHeader
            titleLabel={
              mode === 'assistant'
                ? t('history.records.table.title', '标题')
                : t('history.records.table.session', '会话')
            }
            sourceLabel={mode === 'assistant' ? t('common.assistant') : t('common.agent')}
            timeLabel={t('history.records.table.time', '时间')}
          />

          {itemCount > 0 && mode === 'assistant' ? (
            <TopicHistoryResourceProvider items={topicList} variant="history" onRenameItem={handleTopicRename}>
              <DynamicVirtualList
                list={topicList}
                estimateSize={() => 44}
                overscan={6}
                className="min-h-0 flex-1 bg-card"
                scrollerStyle={{ overflowX: 'hidden', padding: '4px 12px' }}>
                {(topic) => {
                  const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
                  const sourceName = assistant?.name ?? unlinkedAssistantLabel

                  return (
                    <HistoryTopicRow
                      topic={topic}
                      assistant={assistant}
                      sourceName={sourceName}
                      fallbackTitle={t('chat.default.topic.name', '新话题')}
                      timeLabel={formatHistoryTime(topic.updatedAt, t)}
                      isPinned={isTopicPinned(topic.id)}
                      menuPreset={topicMenuPreset}
                      onTogglePin={onToggleTopicPin}
                      onPress={onTopicSelect}
                    />
                  )
                }}
              </DynamicVirtualList>
            </TopicHistoryResourceProvider>
          ) : itemCount > 0 ? (
            <SessionHistoryResourceProvider items={sessionList} variant="history" onRenameItem={handleSessionRename}>
              <DynamicVirtualList
                list={sessionList}
                estimateSize={() => 52}
                overscan={6}
                className="min-h-0 flex-1 bg-card"
                scrollerStyle={{ overflowX: 'hidden', padding: '4px 12px' }}>
                {(session) => {
                  const agent = session.agentId ? agentById.get(session.agentId) : undefined
                  const sourceName = agent?.name ?? t('common.unknown', '未知')

                  return (
                    <HistorySessionRow
                      session={session}
                      agent={agent}
                      sourceName={sourceName}
                      fallbackTitle={t('common.unnamed', '未命名')}
                      timeLabel={formatHistoryTime(session.updatedAt, t)}
                      isPinned={isSessionPinned(session.id)}
                      menuPreset={sessionMenuPreset}
                      onTogglePin={onToggleSessionPin}
                      onPress={onSessionSelect}
                    />
                  )
                }}
              </DynamicVirtualList>
            </SessionHistoryResourceProvider>
          ) : (
            <div className="flex min-h-[320px] flex-1 items-center justify-center px-5 py-8">
              <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface HistoryListHeaderProps {
  titleLabel: string
  sourceLabel: string
  timeLabel: string
}

const HistoryListHeader = ({ titleLabel, sourceLabel, timeLabel }: HistoryListHeaderProps) => (
  <div className="shrink-0 overflow-hidden bg-card [border-bottom:0.5px_solid_var(--color-border-subtle)]">
    <div className={HISTORY_HEADER_GRID_CLASS}>
      <div>{titleLabel}</div>
      <div>{sourceLabel}</div>
      <div>{timeLabel}</div>
    </div>
  </div>
)

interface HistoryTopicRowProps {
  topic: Topic
  assistant?: Assistant
  sourceName: string
  fallbackTitle: string
  timeLabel: string
  isPinned: boolean
  menuPreset?: TopicMenuPreset<Topic>
  onTogglePin?: (topic: Topic) => void | Promise<void>
  onPress?: (topic: Topic) => void
}

const HistoryTopicRow = ({
  topic,
  assistant,
  sourceName,
  fallbackTitle,
  timeLabel,
  isPinned,
  menuPreset,
  onTogglePin,
  onPress
}: HistoryTopicRowProps) => {
  const { t } = useTranslation()
  const context = useResourceList<Topic>()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startRename = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback(
    (name: string) => context.actions.commitRename(topic.id, name),
    [context.actions, topic.id]
  )
  const menuContextOverride = useMemo<TopicMenuActionContextOverride>(
    () => ({ onStartRename: startRename }),
    [startRename]
  )
  const menuActions = menuPreset?.getActions(topic, menuContextOverride)
  const row = (
    <ResourceList.Item
      item={topic}
      className={cn(
        HISTORY_ROW_GRID_CLASS,
        'min-h-11 text-left',
        'bg-card text-foreground-secondary transition-colors hover:bg-muted/45'
      )}
      onClick={() => onPress?.(topic)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PinSlot
          isPinned={isPinned}
          pinLabel={t('chat.topics.pin', '固定话题')}
          unpinLabel={t('chat.topics.unpin', '取消固定')}
          onClick={() => onTogglePin?.(topic)}
        />
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
          {assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} />}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5" data-testid="history-topic-rename-field">
          <span className="truncate font-medium text-foreground-secondary">{topic.name || fallbackTitle}</span>
        </span>
      </div>
      <div className="truncate text-foreground-secondary text-xs">{sourceName}</div>
      <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
    </ResourceList.Item>
  )

  if (!menuPreset || !menuActions) return row

  return (
    <>
      <ResourceList.ContextMenu
        item={topic}
        actions={menuActions}
        confirmDialogContentClassName="z-50"
        confirmDialogOverlayClassName="z-40"
        onAction={(action) => menuPreset.onAction(topic, action, menuContextOverride)}>
        {row}
      </ResourceList.ContextMenu>
      <EditNameDialog
        open={renameDialogOpen}
        title={t('chat.topics.edit.title')}
        initialName={topic.name}
        onSubmit={submitRenameDialog}
        onOpenChange={setRenameDialogOpen}
      />
    </>
  )
}

interface HistorySessionRowProps {
  session: AgentSessionEntity
  agent?: AgentEntity
  sourceName: string
  fallbackTitle: string
  timeLabel: string
  isPinned: boolean
  menuPreset?: SessionMenuPreset<AgentSessionEntity>
  onTogglePin?: (sessionId: string) => void | Promise<void>
  onPress?: (sessionId: string) => void
}

const HistorySessionRow = ({
  session,
  agent,
  sourceName,
  fallbackTitle,
  timeLabel,
  isPinned,
  menuPreset,
  onTogglePin,
  onPress
}: HistorySessionRowProps) => {
  const { t } = useTranslation()
  const context = useResourceList<AgentSessionEntity>()
  const avatar = agent?.configuration?.avatar?.trim()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const startEdit = useCallback(() => setRenameDialogOpen(true), [])
  const submitRenameDialog = useCallback(
    (name: string) => context.actions.commitRename(session.id, name),
    [context.actions, session.id]
  )
  const menuContextOverride = useMemo<SessionMenuActionContextOverride>(() => ({ startEdit }), [startEdit])
  const menuActions = menuPreset?.getActions(session, menuContextOverride)

  const row = (
    <ResourceList.Item
      item={session}
      className={cn(
        HISTORY_ROW_GRID_CLASS,
        'min-h-13 text-left',
        'bg-card text-foreground-secondary transition-colors hover:bg-muted/45'
      )}
      onClick={() => onPress?.(session.id)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PinSlot
          isPinned={isPinned}
          pinLabel={t('selector.common.pin', '固定')}
          unpinLabel={t('selector.common.unpin', '取消固定')}
          onClick={() => onTogglePin?.(session.id)}
        />
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
          {avatar ? <span aria-hidden>{avatar}</span> : <Wrench size={14} />}
        </span>
        <span className="min-w-0 flex-1" data-testid="history-session-rename-field">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-foreground-secondary">{session.name || fallbackTitle}</span>
          </span>
          {session.description && (
            <span className="mt-0.5 block truncate text-foreground-muted text-xs leading-4">{session.description}</span>
          )}
        </span>
      </div>
      <div className="truncate text-foreground-secondary text-xs">{sourceName}</div>
      <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
    </ResourceList.Item>
  )

  if (!menuPreset || !menuActions) return row

  return (
    <>
      <ResourceList.ContextMenu
        item={session}
        actions={menuActions}
        confirmDialogContentClassName="z-50"
        confirmDialogOverlayClassName="z-40"
        onAction={(action) => menuPreset.onAction(session, action, menuContextOverride)}>
        {row}
      </ResourceList.ContextMenu>
      <EditNameDialog
        open={renameDialogOpen}
        title={t('agent.session.edit.title')}
        initialName={session.name ?? ''}
        onSubmit={submitRenameDialog}
        onOpenChange={setRenameDialogOpen}
      />
    </>
  )
}

interface PinSlotProps {
  isPinned: boolean
  pinLabel: string
  unpinLabel: string
  onClick?: () => void | Promise<void>
}

const PinSlot = ({ isPinned, pinLabel, unpinLabel, onClick }: PinSlotProps) => {
  const label = isPinned ? unpinLabel : pinLabel

  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex size-5 items-center justify-center rounded text-foreground-muted transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
          !isPinned && 'opacity-0 group-hover:opacity-100'
        )}
        data-testid="history-pin-button"
        title={label}
        onClick={(event) => {
          event.stopPropagation()
          void onClick?.()
        }}>
        <PinIcon size={12} className={cn(isPinned && '-rotate-45')} />
      </button>
    </span>
  )
}

function formatHistoryTime(value: string, t: ReturnType<typeof useTranslation>['t']) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.records.table.emptyValue', '—')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday', '昨天')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}

export default HistoryResultList
