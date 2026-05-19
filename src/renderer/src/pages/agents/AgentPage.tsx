import { usePreference } from '@data/hooks/usePreference'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import { useCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useAgentSessionInitializer } from '@renderer/hooks/agents/useAgentSessionInitializer'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { type TemporaryConversationDefaults, useTemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import HistoryRecordsPage from '@renderer/pages/history/HistoryRecordsPage'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import type { PropsWithChildren } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AgentChat from './AgentChat'
import AgentSidePanel from './AgentSidePanel'
import { AgentEmpty } from './components/status'

const AgentPage = () => {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyOrigin, setHistoryOrigin] = useState<DOMRectReadOnly>()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { agents } = useAgents()
  const [activeSessionId, setActiveSessionId] = useCache('agent.active_session_id')
  const [sessionRevealRequest, setSessionRevealRequest] = useState<ResourceListRevealRequest>()
  const sessionRevealRequestIdRef = useRef(0)
  const [replacingTemporaryAgent, setReplacingTemporaryAgent] = useState(false)
  const { t } = useTranslation()
  const invalidateCache = useInvalidateCache()
  const temporaryConversation = useTemporaryConversation({ type: 'agent' })
  const {
    conversation: temporaryAgentConversation,
    start: startTemporaryConversation,
    replace: replaceTemporaryConversation,
    persist: persistTemporaryConversation,
    discard: discardTemporaryConversation
  } = temporaryConversation

  // Seed `agent.active_session_id` to the most-recent session when nothing is set.
  useAgentSessionInitializer()

  useShortcut('general.toggle_sidebar', () => {
    toggleShowSidebar()
  })

  useShortcut('topic.toggle_show_topics', () => {
    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  useEffect(() => {
    void window.api.window.setMinimumSize(showSidebar ? MIN_WINDOW_WIDTH : SECOND_MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    return () => {
      void window.api.window.resetMinimumSize()
    }
  }, [showSidebar])

  const openHistory = useCallback((origin?: DOMRectReadOnly) => {
    setHistoryOrigin(origin)
    setHistoryOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const handleHistorySessionSelect = useCallback(
    (sessionId: string | null) => {
      void setShowSidebar(true)
      void discardTemporaryConversation()
      setActiveSessionId(sessionId)

      if (!sessionId) return

      sessionRevealRequestIdRef.current += 1
      setSessionRevealRequest({
        clearFilters: true,
        clearQuery: true,
        itemId: sessionId,
        requestId: sessionRevealRequestIdRef.current
      })
    },
    [discardTemporaryConversation, setActiveSessionId, setShowSidebar]
  )

  const startTemporarySession = useCallback(
    async (defaults: TemporaryConversationDefaults) => {
      if (temporaryAgentConversation?.type === 'agent' && defaults.agentId === temporaryAgentConversation.agentId) {
        setActiveSessionId(null)
        return
      }

      await startTemporaryConversation({ ...defaults, name: defaults.name ?? t('common.unnamed') })
      setActiveSessionId(null)
    },
    [setActiveSessionId, startTemporaryConversation, t, temporaryAgentConversation]
  )

  const persistTemporarySession = useCallback(
    async (initialName?: string) => {
      const persisted = await persistTemporaryConversation(initialName)
      if (persisted?.type === 'agent') {
        await invalidateCache(['/sessions', `/sessions/${persisted.sessionId}`])
        setActiveSessionId(persisted.sessionId)
        return persisted
      }
      return null
    },
    [invalidateCache, persistTemporaryConversation, setActiveSessionId]
  )
  const replaceTemporaryAgent = useCallback(
    async (agentId: string | null) => {
      if (!agentId || temporaryAgentConversation?.type !== 'agent') return
      if (agentId === temporaryAgentConversation.agentId || replacingTemporaryAgent) return

      const agent = agents?.find((candidate) => candidate.id === agentId)
      if (!agent) {
        window.toast.error(t('agent.session.create.error.failed'))
        return
      }
      if (!agent.model) {
        window.toast.error(t('error.model.not_exists'))
        return
      }

      setReplacingTemporaryAgent(true)
      try {
        await replaceTemporaryConversation({
          agentId,
          accessiblePaths: temporaryAgentConversation.accessiblePaths,
          name: temporaryAgentConversation.name ?? t('common.unnamed')
        })
        setActiveSessionId(null)
      } catch (err) {
        window.toast.error(formatErrorMessageWithPrefix(err, t('agent.session.create.error.failed')))
      } finally {
        setReplacingTemporaryAgent(false)
      }
    },
    [agents, replaceTemporaryConversation, replacingTemporaryAgent, setActiveSessionId, t, temporaryAgentConversation]
  )
  const historyOverlay = (
    <HistoryRecordsPage
      mode="agent"
      open={historyOpen}
      activeRecordId={activeSessionId}
      origin={historyOrigin}
      onClose={closeHistory}
      onRecordSelect={handleHistorySessionSelect}
    />
  )

  if (agents && agents.length === 0) {
    return (
      <Container>
        <AgentEmpty />
        {historyOverlay}
      </Container>
    )
  }

  const panePosition = 'left'

  return (
    <Container>
      <div className="flex min-w-0 flex-1 shrink flex-row overflow-hidden">
        <AgentChat
          pane={
            <AgentSidePanel
              onOpenHistory={openHistory}
              revealRequest={sessionRevealRequest}
              onDiscardTemporarySession={discardTemporaryConversation}
              onStartTemporarySession={startTemporarySession}
            />
          }
          paneOpen={showSidebar}
          panePosition={panePosition}
          temporaryConversation={temporaryAgentConversation}
          onStartTemporarySession={startTemporarySession}
          onPersistTemporarySession={persistTemporarySession}
          onTemporarySessionReady={discardTemporaryConversation}
          onDraftAgentChange={replaceTemporaryAgent}
          replacingTemporaryAgent={replacingTemporaryAgent}
        />
      </div>
      {historyOverlay}
    </Container>
  )
}

const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => {
  return (
    <div id="agent-page" className={cn('relative flex flex-1 flex-col overflow-hidden', className)}>
      {children}
    </div>
  )
}

export default AgentPage
