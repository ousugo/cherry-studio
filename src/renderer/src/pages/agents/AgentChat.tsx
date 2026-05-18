import { loggerService } from '@logger'
import { ChatAppShell, type ChatPanePosition, RightPaneHost } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { MessageListInitialLoading } from '@renderer/components/chat/messages/layout/MessageListLoading'
import ExecutionStreamCollector from '@renderer/components/chat/messages/stream/ExecutionStreamCollector'
import { useMessagePartsById } from '@renderer/components/chat/messages/stream/useMessagePartsById'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import ArtifactPane, { ARTIFACT_PANE_WIDTH } from '@renderer/components/chat/panes/ArtifactPane'
import SettingsPanel from '@renderer/components/chat/settings/SettingsPanel'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useActiveSession } from '@renderer/hooks/agents/useSession'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useExecutionChats } from '@renderer/hooks/useExecutionChats'
import { useExecutionMessages } from '@renderer/hooks/useExecutionMessages'
import { useSettings } from '@renderer/hooks/useSettings'
import type { TemporaryConversation, TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import ChatNavigation from '@renderer/pages/agents/components/ChatNavigation'
import { isPerExecutionOnly } from '@renderer/transport/IpcChatTransport'
import type { Citation, GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { ModelSnapshot } from '@shared/data/types/message'
import type { PropsWithChildren, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import AgentChatNavbar from './components/AgentChatNavbar'
import AgentSessionInputbar from './components/AgentSessionInputbar'
import AgentSessionMessages from './components/AgentSessionMessages'

const logger = loggerService.withContext('AgentChat')

interface AgentChatProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  temporaryConversation?: TemporaryConversation | null
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onPersistTemporarySession?: (initialName?: string) => Promise<TemporaryConversation | null>
  onTemporarySessionReady?: () => void | Promise<void>
  onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  replacingTemporaryAgent?: boolean
}

const AgentChat = ({
  pane,
  paneOpen,
  panePosition,
  temporaryConversation,
  onStartTemporarySession,
  onPersistTemporarySession,
  onTemporarySessionReady,
  onDraftAgentChange,
  replacingTemporaryAgent
}: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageStyle } = useSettings()
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [artifactPaneOpen, setArtifactPaneOpen] = useState(false)

  const { session: activeSession, isLoading: isSessionLoading } = useActiveSession()
  const temporaryAgentConversation = temporaryConversation?.type === 'agent' ? temporaryConversation : null
  const invalidateCache = useInvalidateCache()
  const { agent: activeAgent, isLoading: isAgentLoading } = useAgent(
    activeSession?.agentId ?? temporaryAgentConversation?.agentId ?? null
  )

  useEffect(() => {
    if (!activeSession || !temporaryAgentConversation || activeSession.id !== temporaryAgentConversation.sessionId)
      return
    void onTemporarySessionReady?.()
  }, [activeSession, onTemporarySessionReady, temporaryAgentConversation])

  const refreshPersistedSession = useCallback(
    async (sessionId: string) => {
      await invalidateCache(['/sessions', `/sessions/${sessionId}`, `/sessions/${sessionId}/messages`])
    },
    [invalidateCache]
  )

  const watchTemporaryStream = useCallback(
    (topicId: string, sessionId: string) => {
      let doneUnsub: () => void = () => undefined
      let errorUnsub: () => void = () => undefined
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        doneUnsub()
        errorUnsub()
      }
      const refreshAndCleanup = () => {
        cleanup()
        void refreshPersistedSession(sessionId).catch((err) => {
          logger.warn('Failed to refresh persisted temporary session', { sessionId, err })
        })
      }

      doneUnsub = window.api.ai.onStreamDone((data) => {
        if (data.topicId !== topicId || isPerExecutionOnly(data)) return
        refreshAndCleanup()
      })
      errorUnsub = window.api.ai.onStreamError((data) => {
        if (data.topicId !== topicId) return
        refreshAndCleanup()
      })

      return cleanup
    },
    [refreshPersistedSession]
  )

  const sendTemporaryMessage = useCallback(
    async (message?: { text: string }) => {
      if (!temporaryAgentConversation || !onPersistTemporarySession) return
      const persisted = await onPersistTemporarySession(message?.text)
      if (persisted?.type !== 'agent') return

      const cleanupStreamWatcher = watchTemporaryStream(persisted.topicId, persisted.sessionId)
      try {
        await window.api.ai.streamOpen({
          trigger: 'submit-message',
          topicId: persisted.topicId,
          userMessageParts: message?.text ? [{ type: 'text', text: message.text }] : []
        })
      } catch (err) {
        cleanupStreamWatcher()
        await refreshPersistedSession(persisted.sessionId)
        throw err
      }
    },
    [onPersistTemporarySession, refreshPersistedSession, temporaryAgentConversation, watchTemporaryStream]
  )

  const closeArtifactPane = useCallback(() => setArtifactPaneOpen(false), [])
  const toggleArtifactPane = useCallback(() => setArtifactPaneOpen((prev) => !prev), [])

  const isInitializing = isSessionLoading || ((activeSession || temporaryAgentConversation) && isAgentLoading)

  if (isInitializing) {
    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        artifactPaneOpen={artifactPaneOpen}
        artifactPaneWorkspacePath={
          activeSession?.accessiblePaths?.[0] ?? temporaryAgentConversation?.accessiblePaths?.[0]
        }
        onCloseArtifactPane={closeArtifactPane}
        main={<MessageListInitialLoading />}
      />
    )
  }

  if (!activeSession) {
    if (!temporaryAgentConversation) {
      return <AgentChatFrame pane={pane} paneOpen={paneOpen} panePosition={panePosition} main={<div />} />
    }

    const bottomComposer = !isMultiSelectMode ? (
      <AgentSessionInputbar
        agentId={temporaryAgentConversation.agentId}
        sessionId={temporaryAgentConversation.sessionId}
        sessionOverride={temporaryAgentConversation.session}
        sendMessage={sendTemporaryMessage}
        stop={async () => undefined}
        isStreaming={false}
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            accessiblePaths: temporaryAgentConversation.accessiblePaths,
            name: t('common.unnamed')
          })
        }
      />
    ) : undefined

    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        artifactPaneOpen={artifactPaneOpen}
        artifactPaneWorkspacePath={temporaryAgentConversation.accessiblePaths?.[0]}
        onCloseArtifactPane={closeArtifactPane}
        topBar={
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent ?? null}
              onOpenSettings={() => undefined}
              artifactPaneOpen={artifactPaneOpen}
              onToggleArtifactPane={toggleArtifactPane}
              onDraftAgentChange={onDraftAgentChange}
              creatingSession={replacingTemporaryAgent}
              draftMode
            />
          </div>
        }
        main={<div className="h-full w-full" />}
        bottomComposer={bottomComposer}
      />
    )
  }

  // Orphan session — its agent was deleted. Show a read-only placeholder; user
  // must reattach to another agent (UX TBD) or delete the session.
  if (!activeSession.agentId) {
    return (
      <AgentChatFrame
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        artifactPaneOpen={artifactPaneOpen}
        artifactPaneWorkspacePath={activeSession.accessiblePaths?.[0]}
        onCloseArtifactPane={closeArtifactPane}
        main={
          <div className="flex h-full w-full items-center justify-center">
            <WarningAlert message={t('agent.session.orphan.message', 'This session’s agent has been deleted')} />
          </div>
        }
      />
    )
  }

  return (
    <AgentChatInner
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      agentId={activeSession.agentId}
      sessionId={activeSession.id}
      activeAgent={activeAgent}
      messageNavigation={messageNavigation}
      messageStyle={messageStyle}
      isMultiSelectMode={isMultiSelectMode}
      artifactPaneOpen={artifactPaneOpen}
      artifactPaneWorkspacePath={activeSession.accessiblePaths?.[0]}
      onToggleArtifactPane={toggleArtifactPane}
      onCloseArtifactPane={closeArtifactPane}
      onNewSessionDraft={() =>
        onStartTemporarySession?.({
          agentId: activeSession.agentId,
          accessiblePaths: activeSession.accessiblePaths,
          name: t('common.unnamed')
        })
      }
    />
  )
}

// ── Inner: mounted only when agentId + sessionId are resolved ──

interface InnerProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  agentId: string
  sessionId: string
  activeAgent: GetAgentResponse | undefined
  messageNavigation: string
  messageStyle: string
  isMultiSelectMode: boolean
  artifactPaneOpen: boolean
  artifactPaneWorkspacePath?: string
  onToggleArtifactPane: () => void
  onCloseArtifactPane: () => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentChatInner = ({
  pane,
  paneOpen,
  panePosition,
  agentId,
  sessionId,
  activeAgent,
  messageNavigation,
  messageStyle,
  isMultiSelectMode,
  artifactPaneOpen,
  artifactPaneWorkspacePath,
  onToggleArtifactPane,
  onCloseArtifactPane,
  onNewSessionDraft
}: InnerProps) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [narrowMode] = usePreference('chat.narrow_mode')
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(agentId, sessionId)
  const chat = useChatWithHistory(sessionTopicId, uiMessages, refresh)
  const deleteMessage = useCallback(
    async (messageId: string) => {
      await deleteSessionMessage(messageId)
      chat.setMessages((current) => current.filter((message) => message.id !== messageId))
    },
    [chat, deleteSessionMessage]
  )

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    const modelString = activeAgent?.model
    if (!modelString) return undefined
    const [provider, id] = modelString.split(':')
    if (!provider || !id) return undefined
    return { id, name: id, provider }
  }, [activeAgent?.model])

  const { executionMessagesById, handleExecutionMessagesChange, handleExecutionDispose } = useExecutionMessages()
  const partsByMessageId = useMessagePartsById(uiMessages, executionMessagesById)
  const handleToolApprovalRespond = useCallback(
    async ({ match, approved, reason, updatedInput }: MessageToolApprovalInput) => {
      const approvalId = match.approvalId

      const result = await window.api.ai.toolApproval.respond({
        approvalId,
        approved,
        reason,
        updatedInput
      })

      if (!result.ok) throw new Error('Tool approval response was not accepted')
      await refresh()
    },
    [refresh]
  )
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: handleToolApprovalRespond
  })

  const executionChats = useExecutionChats(sessionTopicId, chat.activeExecutions)

  const { isPending } = useTopicStreamStatus(sessionTopicId)
  const citationsPanelOpen = citationPanelCitations !== null

  const handleOpenSettings = useCallback(() => {
    setCitationPanelCitations(null)
    setSettingsOpen(true)
  }, [])

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setSettingsOpen(false)
    setCitationPanelCitations(citations)
  }, [])

  const composerContext = useMemo(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const bottomComposer = useMemo(() => {
    if (isMultiSelectMode) return undefined

    return (
      <ComposerContextProvider value={composerContext}>
        <ComposerCore
          fallback={
            <AgentSessionInputbar
              agentId={agentId}
              sessionId={sessionId}
              sendMessage={chat.sendMessage}
              stop={chat.stop}
              isStreaming={isPending}
              onNewSessionDraft={onNewSessionDraft}
            />
          }
        />
      </ComposerContextProvider>
    )
  }, [
    agentId,
    chat.sendMessage,
    chat.stop,
    composerContext,
    isMultiSelectMode,
    isPending,
    onNewSessionDraft,
    sessionId
  ])

  return (
    <AgentChatFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      artifactPaneOpen={artifactPaneOpen}
      artifactPaneWorkspacePath={artifactPaneWorkspacePath}
      onCloseArtifactPane={onCloseArtifactPane}
      topBar={
        activeAgent && (
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent}
              onOpenSettings={handleOpenSettings}
              artifactPaneOpen={artifactPaneOpen}
              onToggleArtifactPane={onToggleArtifactPane}
            />
          </div>
        )
      }
      main={
        <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
          {chat.activeExecutions.map(({ executionId }) => {
            const execChat = executionChats.get(executionId)
            if (!execChat) return null
            return (
              <ExecutionStreamCollector
                key={executionId}
                executionId={executionId}
                chat={execChat}
                onMessagesChange={handleExecutionMessagesChange}
                onDispose={handleExecutionDispose}
              />
            )
          })}

          <AgentSessionMessages
            agentId={agentId}
            sessionId={sessionId}
            messages={uiMessages}
            activeAgent={activeAgent}
            partsByMessageId={partsByMessageId}
            modelFallback={fallbackSnapshot}
            isLoading={isLoading}
            hasOlder={hasOlder}
            loadOlder={loadOlder}
            onOpenCitationsPanel={handleOpenCitationsPanel}
            deleteMessage={deleteMessage}
            respondToolApproval={handleToolApprovalRespond}
          />
          <div className="mt-auto px-4.5 pb-2">
            <NarrowLayout narrowMode={narrowMode}>
              <PinnedTodoPanel messages={uiMessages} partsByMessageId={partsByMessageId} />
            </NarrowLayout>
          </div>
          {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
        </div>
      }
      bottomComposer={bottomComposer}
      sidePanel={
        <>
          <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} mode="agent" />
          <CitationsPanel
            open={citationsPanelOpen}
            onClose={() => setCitationPanelCitations(null)}
            citations={citationPanelCitations ?? []}
          />
        </>
      }
    />
  )
}

interface AgentChatFrameProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  main: ReactNode
  bottomComposer?: ReactNode
  sidePanel?: ReactNode
  overlay?: ReactNode
  className?: string
  artifactPaneOpen?: boolean
  artifactPaneWorkspacePath?: string
  onCloseArtifactPane?: () => void
}

const AgentChatFrame = ({
  pane,
  paneOpen,
  panePosition,
  topBar,
  main,
  bottomComposer,
  sidePanel,
  overlay,
  className,
  artifactPaneOpen,
  artifactPaneWorkspacePath,
  onCloseArtifactPane
}: AgentChatFrameProps) => (
  <Container className={className}>
    <QuickPanelProvider>
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        main={main}
        bottomComposer={bottomComposer}
        sidePanel={sidePanel}
        overlay={overlay}
      />
    </QuickPanelProvider>
    <RightPaneHost open={artifactPaneOpen} width={ARTIFACT_PANE_WIDTH} className="p-2">
      {onCloseArtifactPane && <ArtifactPane workspacePath={artifactPaneWorkspacePath} onClose={onCloseArtifactPane} />}
    </RightPaneHost>
  </Container>
)

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div className={cn('flex flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-background', className)}>
      {children}
    </div>
  )
}

// Lightweight warning banner — replaces antd `<Alert type="warning">`.
// Mirrors the inline pattern in `MessageErrorBoundary.tsx`.
const WarningAlert = ({ message }: { message: string }) => (
  <div role="alert" className="mx-4 my-1 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
    {message}
  </div>
)

export default AgentChat
