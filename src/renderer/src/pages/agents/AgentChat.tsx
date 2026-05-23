import { type ChatPanePosition, ConversationCenterState, ConversationShell } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { ConversationComposerPlacement } from '@renderer/components/chat/composer'
import { AgentHomeComposer } from '@renderer/components/chat/composer/variants/AgentComposer'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useActiveSession } from '@renderer/hooks/agents/useSession'
import {
  type ConversationHistoryAdapter,
  useConversationTurnController
} from '@renderer/hooks/useConversationTurnController'
import { useSettings } from '@renderer/hooks/useSettings'
import type { TemporaryConversation, TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import type { Citation, GetAgentResponse } from '@renderer/types'
import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChatMain from './AgentChatMain'
import AgentComposerSlot from './AgentComposerSlot'
import AgentChatNavbar from './components/AgentChatNavbar'
import { AgentRightPane } from './components/AgentRightPane'
import {
  type AgentSendOptions,
  type AgentTurnInput,
  getAgentTurnParts,
  useAgentChatRuntimeState
} from './useAgentChatRuntimeState'

const EMPTY_MESSAGES: CherryUIMessage[] = []
const EMPTY_PARTS: Record<string, CherryMessagePart[]> = {}

interface AgentChatProps {
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  pendingSession?: AgentSessionEntity | null
  temporaryConversation?: TemporaryConversation | null
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onPersistTemporarySession?: (initialName?: string) => Promise<TemporaryConversation | null>
  onDraftAgentChange?: (agentId: string | null) => void | Promise<void>
  onDraftWorkspaceChange?: (workspaceId: string) => void | Promise<void>
  onVisibleAgentChange?: (agentId: string) => void
  onVisibleWorkspaceChange?: (workspaceId: string) => void
  replacingTemporaryAgent?: boolean
  replacingTemporaryWorkspace?: boolean
}

const AgentChat = ({
  pane,
  paneOpen,
  panePosition,
  pendingSession,
  temporaryConversation,
  onStartTemporarySession,
  onPersistTemporarySession,
  onDraftAgentChange,
  onDraftWorkspaceChange,
  onVisibleAgentChange,
  onVisibleWorkspaceChange,
  replacingTemporaryAgent,
  replacingTemporaryWorkspace
}: AgentChatProps) => {
  const { t } = useTranslation()
  const { messageStyle } = useSettings()
  const [isMultiSelectMode] = useCache('chat.multi_select_mode')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [reservedSessionSeed, setReservedSessionSeed] = useState<{
    sessionId: string
    messages: CherryUIMessage[]
  } | null>(null)
  const temporarySeedSessionIdRef = useRef<string | null>(null)

  const temporaryAgentConversation = temporaryConversation?.type === 'agent' ? temporaryConversation : null
  const { session: visibleSession, isLoading: isSessionLoading } = useActiveSession({
    pendingSession
  })
  const sessionSnapshot = visibleSession ?? temporaryAgentConversation?.session ?? null
  const visibleAgentId = sessionSnapshot?.agentId ?? temporaryAgentConversation?.agentId ?? null
  const visibleWorkspaceId = sessionSnapshot?.workspaceId ?? null
  const { agent: activeAgent } = useAgent(visibleAgentId)

  useEffect(() => {
    if (visibleAgentId) onVisibleAgentChange?.(visibleAgentId)
  }, [onVisibleAgentChange, visibleAgentId])
  useEffect(() => {
    if (visibleWorkspaceId) onVisibleWorkspaceChange?.(visibleWorkspaceId)
  }, [onVisibleWorkspaceChange, visibleWorkspaceId])

  const temporaryHistoryAdapter = useMemo<ConversationHistoryAdapter>(
    () => ({
      seedReservedMessages: (messages) => {
        const sessionId = temporarySeedSessionIdRef.current
        if (!sessionId) return
        setReservedSessionSeed({ sessionId, messages })
      },
      refresh: () => undefined,
      rollback: () => {
        setReservedSessionSeed(null)
      }
    }),
    []
  )

  const temporaryTurnController = useConversationTurnController<AgentTurnInput, { topicId: string; sessionId: string }>(
    {
      scopeKey: temporaryAgentConversation?.id ?? visibleSession?.id ?? 'none',
      historyAdapter: temporaryHistoryAdapter,
      ensureConversation: async ({ text }) => {
        if (!temporaryAgentConversation || !onPersistTemporarySession) return null
        const persisted = await onPersistTemporarySession(text)
        if (persisted?.type !== 'agent') return null
        temporarySeedSessionIdRef.current = persisted.sessionId
        return { topicId: persisted.topicId, sessionId: persisted.sessionId }
      },
      buildStreamRequest: (input, conversation) => ({
        trigger: 'submit-message',
        topicId: conversation.topicId,
        userMessageParts: getAgentTurnParts(input)
      })
    }
  )
  const sendTemporaryMessage = useCallback(
    async (message?: { text: string }, options?: AgentSendOptions) => {
      await temporaryTurnController.send({ text: message?.text ?? '', options })
    },
    [temporaryTurnController]
  )

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const isInitializing = !sessionSnapshot && isSessionLoading
  const citationsPanelOpen = citationPanelCitations !== null

  if (isInitializing) {
    return (
      <AgentRightPane
        workspacePath={temporaryAgentConversation?.session.workspace?.path}
        messages={EMPTY_MESSAGES}
        partsByMessageId={EMPTY_PARTS}>
        <ConversationShell
          className={messageStyle}
          pane={pane}
          paneOpen={paneOpen}
          panePosition={panePosition}
          center={<ConversationCenterState state="loading" />}
          rightPane={<AgentRightPane.Host />}
        />
      </AgentRightPane>
    )
  }

  if (!sessionSnapshot) {
    return (
      <ConversationShell
        className={messageStyle}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        center={<ConversationCenterState state="empty" />}
      />
    )
  }

  const sessionAgentId = sessionSnapshot.agentId ?? temporaryAgentConversation?.agentId ?? null
  const sendableAgentId = activeAgent && sessionAgentId ? sessionAgentId : undefined
  const isDraftTemporarySession =
    !!temporaryAgentConversation && !visibleSession && temporaryTurnController.layout === 'draft'
  const isTemporaryHandoff = !!temporaryAgentConversation && !visibleSession && !isDraftTemporarySession
  const sessionMessagesEnabled = !!visibleSession || reservedSessionSeed?.sessionId === sessionSnapshot.id
  const homeComposer =
    isDraftTemporarySession && !isMultiSelectMode && temporaryAgentConversation ? (
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
        showWorkspaceSelector
        onNewSessionDraft={() =>
          onStartTemporarySession?.({
            agentId: temporaryAgentConversation.agentId,
            workspaceId: temporaryAgentConversation.session.workspaceId ?? undefined,
            name: t('common.unnamed')
          })
        }
      />
    ) : undefined

  return (
    <AgentChatSessionFrame
      className={cn(messageStyle, { 'multi-select-mode': isMultiSelectMode })}
      pane={pane}
      paneOpen={paneOpen}
      panePosition={panePosition}
      session={sessionSnapshot}
      placement={isDraftTemporarySession ? 'home' : 'docked'}
      homeComposer={homeComposer}
      homeWelcomeText={t('agent.home.welcome_title')}
      agentId={sendableAgentId}
      activeAgent={activeAgent}
      isMultiSelectMode={isMultiSelectMode}
      sessionMessagesEnabled={sessionMessagesEnabled}
      dockedSendDisabled={isTemporaryHandoff}
      dockedStreaming={isTemporaryHandoff}
      reservedMessages={
        reservedSessionSeed?.sessionId === sessionSnapshot.id ? reservedSessionSeed.messages : EMPTY_MESSAGES
      }
      onOpenCitationsPanel={handleOpenCitationsPanel}
      onNewSessionDraft={
        sessionAgentId
          ? () =>
              onStartTemporarySession?.({
                agentId: sessionAgentId,
                workspaceId: sessionSnapshot.workspaceId ?? undefined,
                name: t('common.unnamed')
              })
          : undefined
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

interface AgentChatSessionFrameProps {
  className?: string
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  sidePanel?: ReactNode
  session: AgentSessionEntity
  placement: ConversationComposerPlacement
  homeComposer?: ReactNode
  homeWelcomeText?: string
  agentId?: string
  activeAgent: GetAgentResponse | undefined
  isMultiSelectMode: boolean
  sessionMessagesEnabled: boolean
  dockedSendDisabled?: boolean
  dockedStreaming?: boolean
  reservedMessages?: CherryUIMessage[]
  onOpenCitationsPanel: (payload: { citations: Citation[] }) => void
  onNewSessionDraft?: () => void | Promise<void>
}

const AgentChatSessionFrame = ({
  className,
  pane,
  paneOpen,
  panePosition,
  sidePanel,
  session,
  placement,
  homeComposer,
  homeWelcomeText,
  agentId,
  activeAgent,
  isMultiSelectMode,
  sessionMessagesEnabled,
  dockedSendDisabled = false,
  dockedStreaming = false,
  reservedMessages = EMPTY_MESSAGES,
  onOpenCitationsPanel,
  onNewSessionDraft
}: AgentChatSessionFrameProps) => {
  const runtime = useAgentChatRuntimeState({
    session,
    activeAgent,
    sessionMessagesEnabled,
    reservedMessages
  })
  const composer = (
    <AgentComposerSlot
      placement={placement}
      homeComposer={homeComposer}
      agentId={agentId}
      isMultiSelectMode={isMultiSelectMode}
      session={session}
      sessionId={runtime.sessionId}
      sendMessage={runtime.sendMessage}
      stop={runtime.stop}
      isStreaming={dockedStreaming || runtime.isPending}
      sendDisabled={dockedSendDisabled}
      onNewSessionDraft={onNewSessionDraft}
      composerContext={runtime.composerContext}
    />
  )
  const main = (
    <AgentChatMain
      placement={placement}
      sessionMessagesEnabled={sessionMessagesEnabled}
      agentId={agentId}
      sessionId={runtime.sessionId}
      messages={runtime.uiMessages}
      activeAgent={activeAgent}
      partsByMessageId={runtime.partsByMessageId}
      modelFallback={runtime.fallbackSnapshot}
      isLoading={runtime.isLoading}
      hasOlder={runtime.hasOlder}
      loadOlder={runtime.loadOlder}
      onOpenCitationsPanel={onOpenCitationsPanel}
      deleteMessage={runtime.deleteMessage}
      respondToolApproval={runtime.respondToolApproval}
    />
  )

  return (
    <AgentRightPane
      workspacePath={session.workspace?.path}
      messages={runtime.uiMessages}
      partsByMessageId={runtime.partsByMessageId}
      sessionId={runtime.sessionId}
      sessionName={session.name}
      agentId={agentId ?? session.agentId ?? undefined}
      agentName={activeAgent?.name}
      agentAvatar={activeAgent?.configuration?.avatar}
      modelFallback={runtime.fallbackSnapshot}>
      <ConversationShell
        className={className}
        pane={pane}
        paneOpen={paneOpen}
        panePosition={panePosition}
        topBar={
          <div className="flex h-fit w-full min-w-0">
            <AgentChatNavbar
              className="min-w-0"
              activeAgent={activeAgent ?? null}
              tools={<AgentRightPane.FilesToggle />}
            />
          </div>
        }
        center={
          <ConversationStageCenter
            placement={placement}
            main={main}
            composer={composer}
            homeWelcomeText={homeWelcomeText}
          />
        }
        sidePanel={sidePanel}
        centerOverlay={<AgentRightPane.MaximizedOverlay />}
        rightPane={<AgentRightPane.Host />}
      />
    </AgentRightPane>
  )
}

export default AgentChat
