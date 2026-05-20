import { loggerService } from '@logger'
import { ChatAppShell, type ChatPanePosition, RightPaneHost } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import ComposerDockTransitionFrame from '@renderer/components/chat/composer/ComposerDockTransitionFrame'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import AgentComposer, { AgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { MessageListInitialLoading } from '@renderer/components/chat/messages/layout/MessageListLoading'
import type { MessageToolApprovalInput } from '@renderer/components/chat/messages/types'
import ArtifactPane, { ARTIFACT_PANE_WIDTH } from '@renderer/components/chat/panes/ArtifactPane'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useActiveSession } from '@renderer/hooks/agents/useSession'
import { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useSettings } from '@renderer/hooks/useSettings'
import type { TemporaryConversation, TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
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
  onDraftWorkspaceChange?: (workspaceId: string) => void | Promise<void>
  replacingTemporaryAgent?: boolean
  replacingTemporaryWorkspace?: boolean
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
  onDraftWorkspaceChange,
  replacingTemporaryAgent,
  replacingTemporaryWorkspace
}: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageStyle } = useSettings()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [artifactPaneOpen, setArtifactPaneOpen] = useState(false)
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [temporaryComposerDocked, setTemporaryComposerDocked] = useState(false)

  const { session: activeSession, isLoading: isSessionLoading } = useActiveSession()
  const temporaryAgentConversation = temporaryConversation?.type === 'agent' ? temporaryConversation : null
  const invalidateCache = useInvalidateCache()
  const { agent: activeAgent, isLoading: isAgentLoading } = useAgent(
    activeSession?.agentId ?? temporaryAgentConversation?.agentId ?? null
  )

  useEffect(() => {
    setTemporaryComposerDocked(false)
  }, [temporaryAgentConversation?.id])

  useEffect(() => {
    if (!activeSession || !temporaryAgentConversation || activeSession.id !== temporaryAgentConversation.sessionId)
      return
    void onTemporarySessionReady?.()
  }, [activeSession, onTemporarySessionReady, temporaryAgentConversation])

  const refreshPersistedSession = useCallback(
    async (sessionId: string) => {
      await invalidateCache(['/sessions', '/workspaces', `/sessions/${sessionId}`, `/sessions/${sessionId}/messages`])
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
      setTemporaryComposerDocked(true)
      let persisted: TemporaryConversation | null
      try {
        persisted = await onPersistTemporarySession(message?.text)
      } catch (err) {
        setTemporaryComposerDocked(false)
        throw err
      }
      if (persisted?.type !== 'agent') {
        setTemporaryComposerDocked(false)
        return
      }

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
        setTemporaryComposerDocked(false)
        await refreshPersistedSession(persisted.sessionId)
        throw err
      }
    },
    [onPersistTemporarySession, refreshPersistedSession, temporaryAgentConversation, watchTemporaryStream]
  )

  const closeArtifactPane = useCallback(() => setArtifactPaneOpen(false), [])
  const toggleArtifactPane = useCallback(() => setArtifactPaneOpen((prev) => !prev), [])
  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
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
          activeSession?.workspace?.path ?? temporaryAgentConversation?.session.workspace?.path
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
        workspaceId={temporaryAgentConversation.session.workspaceId}
        onWorkspaceChange={onDraftWorkspaceChange}
        workspaceChanging={replacingTemporaryWorkspace}
        showWorkspaceSelector={!temporaryComposerDocked}
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            workspaceId: temporaryAgentConversation.session.workspaceId ?? undefined,
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
        artifactPaneWorkspacePath={temporaryAgentConversation.session.workspace?.path}
        onCloseArtifactPane={closeArtifactPane}
        topBar={
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent ?? null}
              artifactPaneOpen={artifactPaneOpen}
              onToggleArtifactPane={toggleArtifactPane}
            />
          </div>
        }
        main={
          <ComposerDockTransitionFrame
            placement={temporaryComposerDocked ? 'docked' : 'home'}
            main={<div className="h-full min-h-0 flex-1" />}
            composer={homeComposer}
            mainVisible={temporaryComposerDocked}
          />
        }
        sidePanel={
          <CitationsPanel
            open={citationsPanelOpen}
            onClose={() => setCitationPanelCitations(null)}
            citations={citationPanelCitations ?? []}
          />
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
      artifactPaneWorkspacePath={activeSession.workspace?.path}
      onCloseArtifactPane={closeArtifactPane}
      topBar={
        <div className="flex h-fit w-full min-w-0">
          <AgentChatNavbar
            className="min-w-0"
            activeAgent={activeAgent ?? null}
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
          isMultiSelectMode={isMultiSelectMode}
          onOpenCitationsPanel={handleOpenCitationsPanel}
          onNewSessionDraft={
            sendableAgentId
              ? () =>
                  onStartTemporarySession?.({
                    agentId: sendableAgentId,
                    workspaceId: activeSession.workspaceId ?? undefined,
                    name: t('common.unnamed')
                  })
              : undefined
          }
        />
      }
      sidePanel={
        <CitationsPanel
          open={citationsPanelOpen}
          onClose={() => setCitationPanelCitations(null)}
          citations={citationPanelCitations ?? []}
        />
      }
    />
  )
}

// ── Inner: session-scoped history; agentId is present only while the session is sendable ──

interface InnerProps {
  agentId?: string
  sessionId: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentChatSessionContent = ({
  agentId,
  sessionId,
  activeAgent,
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

  const basePartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of uiMessages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    return next
  }, [uiMessages])

  const { overlay } = useExecutionOverlay(sessionTopicId, chat.activeExecutions, uiMessages)

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next = { ...basePartsMap }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (parts.length) next[messageId] = parts
    }
    return next
  }, [basePartsMap, overlay])

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

  const main = (
    <div className="translate-z-0 relative flex w-full flex-1 flex-col justify-between overflow-y-auto overflow-x-hidden">
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
    </div>
  )

  return <ComposerDockTransitionFrame placement="docked" main={main} composer={bottomComposer} mainVisible />
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
