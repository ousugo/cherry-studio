import { loggerService } from '@logger'
import { ChatAppShell, type ChatPanePosition, RightPaneHost } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import AgentComposer, { AgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
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
import type { CherryMessagePart, ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { PropsWithChildren, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import AgentChatNavbar from './components/AgentChatNavbar'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)

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
    async (message?: { text: string }, options?: { body?: Record<string, unknown> }) => {
      if (!temporaryAgentConversation || !onPersistTemporarySession) return
      const persisted = await onPersistTemporarySession(message?.text)
      if (persisted?.type !== 'agent') return

      const userMessageParts =
        (options?.body?.userMessageParts as CherryMessagePart[] | undefined) ??
        (message?.text ? [{ type: 'text', text: message.text }] : [])

      const cleanupStreamWatcher = watchTemporaryStream(persisted.topicId, persisted.sessionId)
      try {
        await window.api.ai.streamOpen({
          trigger: 'submit-message',
          topicId: persisted.topicId,
          userMessageParts
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
  const handleOpenSettings = useCallback(() => {
    setCitationPanelCitations(null)
    setSettingsOpen(true)
  }, [])
  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setSettingsOpen(false)
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing =
    isSessionLoading ||
    Boolean(
      (activeSession || temporaryAgentConversation) &&
        (activeSession?.agentId || temporaryAgentConversation?.agentId) &&
        isAgentLoading
    )
  const citationsPanelOpen = citationPanelCitations !== null

  if (isInitializing) {
    return (
      <AgentChatFrame
        className={messageStyle}
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
      return (
        <AgentChatFrame
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          main={<div />}
        />
      )
    }

    const homeComposer = !isMultiSelectMode ? (
      <AgentHomeComposer
        agentId={temporaryAgentConversation.agentId}
        sessionId={temporaryAgentConversation.sessionId}
        sessionOverride={temporaryAgentConversation.session}
        sendMessage={sendTemporaryMessage}
        stop={async () => undefined}
        isStreaming={false}
        onAgentChange={onDraftAgentChange}
        agentChanging={replacingTemporaryAgent}
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            accessiblePaths: temporaryAgentConversation.accessiblePaths,
            name: t('common.unnamed')
          })
        }
      />
    ) : null

    return (
      <AgentChatFrame
        className={messageStyle}
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
              onOpenSettings={handleOpenSettings}
              artifactPaneOpen={artifactPaneOpen}
              onToggleArtifactPane={toggleArtifactPane}
            />
          </div>
        }
        main={
          <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 pb-[12vh]">
            <div className="w-full">{homeComposer}</div>
          </div>
        }
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

  const sendableAgentId = activeAgent ? (activeSession.agentId ?? undefined) : undefined

  return (
    <AgentChatFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      artifactPaneOpen={artifactPaneOpen}
      artifactPaneWorkspacePath={activeSession.accessiblePaths?.[0]}
      onCloseArtifactPane={closeArtifactPane}
      topBar={
        <div className="flex h-fit w-full min-w-0">
          <AgentChatNavbar
            className="min-w-0"
            activeAgent={activeAgent ?? null}
            onOpenSettings={handleOpenSettings}
            artifactPaneOpen={artifactPaneOpen}
            onToggleArtifactPane={toggleArtifactPane}
          />
        </div>
      }
      centerContent={
        <AgentChatSessionContent
          key={activeSession.id}
          agentId={sendableAgentId}
          sessionId={activeSession.id}
          activeAgent={activeAgent}
          messageNavigation={messageNavigation}
          isMultiSelectMode={isMultiSelectMode}
          onOpenCitationsPanel={handleOpenCitationsPanel}
          onNewSessionDraft={
            sendableAgentId
              ? () =>
                  onStartTemporarySession?.({
                    agentId: sendableAgentId,
                    accessiblePaths: activeSession.accessiblePaths,
                    name: t('common.unnamed')
                  })
              : undefined
          }
        />
      }
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

// ── Inner: session-scoped history; agentId is present only while the session is sendable ──

interface InnerProps {
  agentId?: string
  sessionId: string
  activeAgent: GetAgentResponse | undefined
  messageNavigation: string
  isMultiSelectMode: boolean
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentChatSessionContent = ({
  agentId,
  sessionId,
  activeAgent,
  messageNavigation,
  isMultiSelectMode,
  onOpenCitationsPanel,
  onNewSessionDraft
}: InnerProps) => {
  const [narrowMode] = usePreference('chat.narrow_mode')
  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const {
    messages: uiMessages,
    isLoading,
    hasOlder,
    loadOlder,
    refresh,
    deleteMessage: deleteSessionMessage
  } = useAgentSessionParts(sessionId)
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
    if (!isUniqueModelId(modelString)) return undefined
    const { providerId, modelId } = parseUniqueModelId(modelString)
    if (!providerId || !modelId) return undefined
    return { id: modelId, name: activeAgent?.modelName ?? modelId, provider: providerId }
  }, [activeAgent?.model, activeAgent?.modelName])

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

  const composerContext = useMemo(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const bottomComposer = useMemo(() => {
    if (isMultiSelectMode || !agentId) return undefined

    return (
      <ComposerContextProvider value={composerContext}>
        <ComposerCore
          fallback={
            <AgentComposer
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
    <>
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
          onOpenCitationsPanel={onOpenCitationsPanel}
          deleteMessage={agentId ? deleteMessage : undefined}
          respondToolApproval={agentId ? handleToolApprovalRespond : undefined}
        />
        <div className="mt-auto px-4.5 pb-2">
          <NarrowLayout narrowMode={narrowMode}>
            <PinnedTodoPanel messages={uiMessages} partsByMessageId={partsByMessageId} />
          </NarrowLayout>
        </div>
        {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
      </div>
      {bottomComposer}
    </>
  )
}

interface AgentChatFrameBaseProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  topBar?: ReactNode
  sidePanel?: ReactNode
  overlay?: ReactNode
  className?: string
  artifactPaneOpen?: boolean
  artifactPaneWorkspacePath?: string
  onCloseArtifactPane?: () => void
}

type AgentChatFrameMainProps = AgentChatFrameBaseProps & {
  main: ReactNode
  bottomComposer?: ReactNode
  centerContent?: never
}

type AgentChatFrameCenterContentProps = AgentChatFrameBaseProps & {
  centerContent: ReactNode
  main?: never
  bottomComposer?: never
}

type AgentChatFrameProps = AgentChatFrameMainProps | AgentChatFrameCenterContentProps

const AgentChatFrame = ({
  pane,
  paneOpen,
  panePosition,
  topBar,
  main,
  centerContent,
  bottomComposer,
  sidePanel,
  overlay,
  className,
  artifactPaneOpen,
  artifactPaneWorkspacePath,
  onCloseArtifactPane
}: AgentChatFrameProps) => {
  const shell =
    centerContent !== undefined ? (
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        centerContent={centerContent}
        sidePanel={sidePanel}
        overlay={overlay}
      />
    ) : (
      <ChatAppShell
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={topBar}
        main={main ?? null}
        bottomComposer={bottomComposer}
        sidePanel={sidePanel}
        overlay={overlay}
      />
    )

  return (
    <Container className={className}>
      <QuickPanelProvider>{shell}</QuickPanelProvider>
      <RightPaneHost open={artifactPaneOpen} width={ARTIFACT_PANE_WIDTH} className="p-2">
        {onCloseArtifactPane && (
          <ArtifactPane workspacePath={artifactPaneWorkspacePath} onClose={onCloseArtifactPane} />
        )}
      </RightPaneHost>
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div
      className={cn(
        'flex flex-1 overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-(--color-background)',
        className
      )}>
      {children}
    </div>
  )
}

export default AgentChat
