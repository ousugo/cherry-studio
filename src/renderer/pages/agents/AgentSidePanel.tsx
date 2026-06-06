import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { TemporaryConversationDefaults } from '@renderer/hooks/useTemporaryConversation'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import Sessions from './components/Sessions'

interface AgentSidePanelProps {
  activeSessionId: string | null
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  onSelectItem?: () => void
  onStartTemporarySession?: (defaults: TemporaryConversationDefaults) => void | Promise<void>
  onStartMissingAgentDraft?: () => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
  setActiveSessionId: (id: string | null, session?: AgentSessionEntity | null) => void
}

const AgentSidePanel = ({
  activeSessionId,
  onOpenHistory,
  onSelectItem,
  onStartTemporarySession,
  onStartMissingAgentDraft,
  revealRequest,
  setActiveSessionId
}: AgentSidePanelProps) => {
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 'var(--assistants-width)',
        height: 'calc(100vh - var(--navbar-height))'
      }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Sessions
          activeSessionId={activeSessionId}
          setActiveSessionId={setActiveSessionId}
          onOpenHistory={onOpenHistory}
          onSelectItem={onSelectItem}
          revealRequest={revealRequest}
          onStartTemporarySession={onStartTemporarySession}
          onStartMissingAgentDraft={onStartMissingAgentDraft}
        />
      </div>
    </div>
  )
}

export default AgentSidePanel
