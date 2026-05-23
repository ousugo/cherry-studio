import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentPageMocks = vi.hoisted(() => ({
  activeSessionId: 'session-initial' as string | null,
  agents: [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }],
  lastUsedAgentId: null as string | null,
  setActiveSessionId: vi.fn(),
  setLastUsedAgentId: vi.fn(),
  setShowSidebar: vi.fn()
}))

const temporaryConversationMocks = vi.hoisted(() => ({
  conversation: null as any,
  start: vi.fn(),
  replace: vi.fn(),
  persist: vi.fn(),
  discard: vi.fn()
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState<unknown>(key === 'topic.tab.show' ? false : undefined)
      const setPreference = vi.fn(async (nextValue: unknown) => {
        if (key === 'topic.tab.show') {
          agentPageMocks.setShowSidebar(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setPreference]
    }
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: { children?: ReactNode }) => <nav>{children}</nav>,
  NavbarCenter: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    useCache: (key: string) => {
      const [activeSessionId, setActiveSessionId] = React.useState(agentPageMocks.activeSessionId)
      if (key !== 'agent.active_session_id') return [undefined, vi.fn()]

      const setCache = vi.fn((nextSessionId: string | null) => {
        agentPageMocks.activeSessionId = nextSessionId
        agentPageMocks.setActiveSessionId(nextSessionId)
        setActiveSessionId(nextSessionId)
      })

      return [activeSessionId, setCache]
    },
    usePersistCache: (key: string) => {
      const [lastUsedAgentId, setLastUsedAgentId] = React.useState(agentPageMocks.lastUsedAgentId)
      if (key !== 'ui.agent.last_used_agent_id') return [undefined, vi.fn()]

      const setCache = vi.fn((nextAgentId: string | null) => {
        agentPageMocks.lastUsedAgentId = nextAgentId
        agentPageMocks.setLastUsedAgentId(nextAgentId)
        setLastUsedAgentId(nextAgentId)
      })

      return [lastUsedAgentId, setCache]
    }
  }
})

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgents: () => ({
    agents: agentPageMocks.agents
  })
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/hooks/useTemporaryConversation', () => ({
  useTemporaryConversation: () => ({
    conversation: temporaryConversationMocks.conversation,
    start: temporaryConversationMocks.start,
    replace: temporaryConversationMocks.replace,
    persist: temporaryConversationMocks.persist,
    discard: temporaryConversationMocks.discard
  })
}))

vi.mock('@renderer/pages/history/HistoryRecordsPage', () => ({
  default: ({ onClose, onRecordSelect, open }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onRecordSelect?.('session-history')
          onClose?.()
        }}>
        Select history session
      </button>
    ) : null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
    SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    init: vi.fn(),
    type: '3rdParty'
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../AgentChat', () => ({
  default: ({
    onVisibleAgentChange,
    onDraftWorkspaceChange,
    pane,
    paneOpen
  }: {
    onVisibleAgentChange?: (agentId: string) => void
    onDraftWorkspaceChange?: (workspaceId: string) => void | Promise<void>
    pane?: ReactNode
    paneOpen?: boolean
  }) => (
    <section>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      <button type="button" onClick={() => void onDraftWorkspaceChange?.('workspace-next')}>
        Select workspace
      </button>
      <button type="button" onClick={() => onVisibleAgentChange?.('agent-visible')}>
        Show visible agent
      </button>
      {pane}
    </section>
  )
}))

vi.mock('../AgentSidePanel', () => ({
  default: ({ onOpenHistory, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="agent-side-panel">
      <button type="button" onClick={() => onOpenHistory?.()}>
        Open agent history
      </button>
    </div>
  )
}))

vi.mock('../components/status', () => ({
  AgentEmpty: () => <div>No agents</div>
}))

import AgentPage from '../AgentPage'

describe('AgentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentPageMocks.activeSessionId = 'session-initial'
    agentPageMocks.agents = [{ id: 'agent-a', model: 'model-a', name: 'Agent A' }]
    agentPageMocks.lastUsedAgentId = null
    temporaryConversationMocks.conversation = null
    temporaryConversationMocks.start.mockResolvedValue(null)

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('opens the agent sidebar and forwards a reveal request after selecting a history session', async () => {
    render(<AgentPage />)

    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Open agent history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history session' }))

    await waitFor(() => expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith('session-history'))

    expect(agentPageMocks.setShowSidebar).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('agent-side-panel').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      clearFilters: true,
      clearQuery: true,
      itemId: 'session-history',
      requestId: 1
    })
  })

  it('replaces the temporary agent conversation when the draft workspace changes', async () => {
    agentPageMocks.activeSessionId = null
    temporaryConversationMocks.conversation = {
      type: 'agent',
      id: 'temporary-session',
      sessionId: 'temporary-session',
      topicId: 'agent-session:temporary-session',
      agentId: 'agent-a',
      name: 'Draft',
      session: {
        id: 'temporary-session',
        agentId: 'agent-a',
        name: 'Draft',
        description: '',
        workspaceId: 'workspace-current',
        workspace: {
          id: 'workspace-current',
          name: 'Current Workspace',
          path: '/workspace/current',
          orderKey: 'a0',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    temporaryConversationMocks.replace.mockResolvedValue({
      ...temporaryConversationMocks.conversation,
      session: {
        ...temporaryConversationMocks.conversation.session,
        workspaceId: 'workspace-next'
      }
    })

    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Select workspace' }))

    await waitFor(() =>
      expect(temporaryConversationMocks.replace).toHaveBeenCalledWith({
        agentId: 'agent-a',
        workspaceId: 'workspace-next',
        name: 'Draft'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('starts a first-launch temporary session with the remembered agent', async () => {
    agentPageMocks.activeSessionId = null
    agentPageMocks.agents = [
      { id: 'agent-a', model: 'model-a', name: 'Agent A' },
      { id: 'agent-b', model: 'model-b', name: 'Agent B' }
    ]
    agentPageMocks.lastUsedAgentId = 'agent-b'

    render(<AgentPage />)

    await waitFor(() =>
      expect(temporaryConversationMocks.start).toHaveBeenCalledWith({
        agentId: 'agent-b',
        name: 'common.unnamed'
      })
    )
    expect(agentPageMocks.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('records the visible agent reported by the chat body', async () => {
    render(<AgentPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Show visible agent' }))

    await waitFor(() => expect(agentPageMocks.setLastUsedAgentId).toHaveBeenCalledWith('agent-visible'))
  })
})
