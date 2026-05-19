import { fireEvent, render, screen } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentChat from '../AgentChat'

vi.mock('@renderer/components/chat', () => ({
  ChatAppShell: ({
    pane,
    paneOpen,
    panePosition,
    topBar,
    sidePanel,
    main,
    centerContent,
    bottomComposer,
    overlay
  }: {
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
    topBar?: ReactNode
    sidePanel?: ReactNode
    main?: ReactNode
    centerContent?: ReactNode
    bottomComposer?: ReactNode
    overlay?: ReactNode
  }) => (
    <div data-testid="chat-app-shell" data-pane-open={String(Boolean(paneOpen))} data-pane-position={panePosition}>
      <div data-testid="agent-top-bar">{topBar}</div>
      <div data-testid="shell-pane">{pane}</div>
      <div data-testid="agent-side-panel">{sidePanel}</div>
      <div>{centerContent ?? main}</div>
      <div>{bottomComposer}</div>
      <div>{overlay}</div>
    </div>
  ),
  LoadingState: () => <div data-testid="loading-state" />,
  RightPaneHost: ({
    children,
    open,
    width
  }: PropsWithChildren<{
    open?: boolean
    width?: string | number
  }>) => (
    <section data-testid="artifact-right-pane" data-open={String(Boolean(open))} data-width={String(width)}>
      {open ? children : null}
    </section>
  )
}))

vi.mock('@renderer/components/chat/panes/ArtifactPane', () => ({
  ARTIFACT_PANE_WIDTH: 460,
  default: ({ workspacePath, onClose }: { workspacePath?: string; onClose: () => void }) => (
    <div data-testid="artifact-pane" data-workspace-path={workspacePath ?? ''}>
      <button type="button" onClick={onClose}>
        close artifact pane
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/composer/ComposerContext', () => ({
  ComposerContextProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/chat/composer/ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>
}))

vi.mock('@renderer/components/chat/composer/useToolApprovalComposerOverrides', () => ({
  useToolApprovalComposerOverrides: () => ({})
}))

vi.mock('@renderer/components/chat/composer/ComposerDockTransitionFrame', () => ({
  default: ({
    placement,
    main,
    composer,
    mainVisible
  }: {
    placement: string
    main: ReactNode
    composer: ReactNode
    mainVisible?: boolean
  }) => (
    <div data-testid="composer-dock-frame" data-placement={placement} data-main-visible={String(Boolean(mainVisible))}>
      {main}
      {composer}
    </div>
  )
}))

vi.mock('@renderer/components/chat/messages/stream/useMessagePartsById', () => ({
  useMessagePartsById: () => ({})
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useCache: () => [false]
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: (key: string) => [key === 'chat.narrow_mode' ? false : 'none', vi.fn()]
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: () => ({
    agent: { id: 'agent-1', model: 'provider:model-1' },
    isLoading: false
  }),
  useAgents: () => ({
    agents: [
      { id: 'agent-1', model: 'provider:model-1' },
      { id: 'agent-2', model: 'provider:model-2' }
    ],
    isLoading: false
  })
}))

const activeSessionMocks = vi.hoisted(() => ({
  result: {
    session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
    isLoading: false,
    setActiveSessionId: vi.fn()
  } as {
    session: { id: string; agentId: string | null; workspace: { path: string } | null } | undefined
    isLoading: boolean
    setActiveSessionId: ReturnType<typeof vi.fn>
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => vi.fn()
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => activeSessionMocks.result
}))

vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: () => ({
    messages: [],
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    refresh: vi.fn(),
    deleteMessage: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({
    activeExecutions: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useExecutionChats', () => ({
  useExecutionChats: () => new Map()
}))

vi.mock('@renderer/hooks/useExecutionMessages', () => ({
  useExecutionMessages: () => ({
    executionMessagesById: {},
    handleExecutionMessagesChange: vi.fn(),
    handleExecutionDispose: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({
    messageNavigation: 'none',
    messageStyle: 'message-style'
  })
}))

vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false })
}))

vi.mock('@renderer/utils/agentSession', () => ({
  buildAgentSessionTopicId: (sessionId: string) => `agent-session:${sessionId}`
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../components/AgentChatNavbar', () => ({
  default: ({
    artifactPaneOpen,
    onToggleArtifactPane
  }: {
    artifactPaneOpen?: boolean
    onToggleArtifactPane?: () => void
  }) => (
    <div>
      <button type="button" aria-pressed={Boolean(artifactPaneOpen)} onClick={onToggleArtifactPane}>
        toggle artifact pane
      </button>
    </div>
  )
}))

vi.mock('@renderer/components/chat/composer/variants/AgentComposer', () => ({
  default: () => <div data-testid="agent-composer" />,
  AgentHomeComposer: () => <div data-testid="agent-home-composer" />
}))

vi.mock('../components/AgentSessionMessages', () => ({
  default: () => <div data-testid="agent-messages" />
}))

vi.mock('@renderer/components/chat/citations/CitationsPanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="citations-panel" data-open={String(open)} />
}))

vi.mock('../../home/Inputbar/components/PinnedTodoPanel', () => ({
  PinnedTodoPanel: () => <div data-testid="pinned-todo-panel" />
}))

describe('AgentChat artifact pane', () => {
  beforeEach(() => {
    activeSessionMocks.result = {
      session: { id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: vi.fn()
          }
        }
      }
    })
  })

  it('opens and closes the artifact pane without replacing the existing chat shell pane', () => {
    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-open', 'true')
    expect(screen.getByTestId('chat-app-shell')).toHaveAttribute('data-pane-position', 'left')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')

    const toggle = screen.getByRole('button', { name: 'toggle artifact pane' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-width', '460')
    expect(screen.getByTestId('artifact-pane')).toHaveAttribute('data-workspace-path', '/tmp/workspace')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'close artifact pane' }))

    expect(screen.getByTestId('artifact-right-pane')).toHaveAttribute('data-open', 'false')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('session-pane')).toBeInTheDocument()
  })

  it('renders the temporary session composer in home placement', () => {
    activeSessionMocks.result = {
      session: undefined,
      isLoading: false,
      setActiveSessionId: vi.fn()
    }

    render(
      <AgentChat
        temporaryConversation={
          {
            type: 'agent',
            id: 'temp-session-1',
            sessionId: 'temp-session-1',
            topicId: 'agent-session:temp-session-1',
            agentId: 'agent-1',
            workspace: { path: '/tmp/workspace' },
            name: 'Temp Session',
            session: { id: 'temp-session-1', agentId: 'agent-1', workspace: { path: '/tmp/workspace' } }
          } as any
        }
      />
    )

    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-placement', 'home')
    expect(screen.getByTestId('composer-dock-frame')).toHaveAttribute('data-main-visible', 'false')
    expect(screen.getByTestId('agent-home-composer')).toBeInTheDocument()
  })

  it('keeps the session pane mounted while a selected session reloads', () => {
    const paneMounts: string[] = []

    function SessionPane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        paneMounts.push('mounted')
      }, [])

      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          pane count {count}
        </button>
      )
    }

    const { rerender } = render(<AgentChat pane={<SessionPane />} paneOpen={true} panePosition="left" />)

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))
    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    activeSessionMocks.result = {
      session: undefined,
      isLoading: true,
      setActiveSessionId: vi.fn()
    }
    rerender(<AgentChat pane={<SessionPane />} paneOpen={true} panePosition="left" />)

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()
    expect(paneMounts).toEqual(['mounted'])
  })

  it('shows history without composer for an unlinked session', () => {
    activeSessionMocks.result = {
      session: { id: 'session-unlinked', agentId: null, workspace: { path: '/tmp/workspace' } },
      isLoading: false,
      setActiveSessionId: vi.fn()
    }

    render(<AgentChat pane={<aside data-testid="session-pane" />} paneOpen={true} panePosition="left" />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-messages')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-composer')).not.toBeInTheDocument()
  })
})
