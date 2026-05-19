import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeSession: null as any
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => ({ session: mocks.activeSession })
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
}))

vi.mock('../../AgentSidePanelDrawer', () => ({
  default: { show: vi.fn() }
}))

vi.mock('../OpenExternalAppButton', () => ({
  default: () => <button type="button">open workspace</button>
}))

vi.mock('../Tools', () => ({
  default: () => <span>tools</span>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import AgentContent from '../AgentContent'

const agentA = {
  id: 'agent-a',
  name: 'Agent A',
  model: 'provider:model-a',
  type: 'claude_code'
} as any

describe('AgentContent', () => {
  beforeEach(() => {
    mocks.activeSession = null
  })

  it('keeps agent page tools in the navbar', () => {
    render(<AgentContent activeAgent={agentA} artifactPaneOpen={false} onToggleArtifactPane={vi.fn()} />)

    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.queryByText('select agent b')).not.toBeInTheDocument()
    expect(screen.queryByText('select model b')).not.toBeInTheDocument()
  })

  it('keeps the workspace opener when a session workspace exists', () => {
    mocks.activeSession = { id: 'session-1', agentId: 'agent-a', workspace: { path: '/workspace' } }

    render(<AgentContent activeAgent={agentA} artifactPaneOpen={false} onToggleArtifactPane={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'open workspace' })).toBeInTheDocument()
  })

  it('hides agent-scoped navbar actions when no agent is active', () => {
    render(<AgentContent activeAgent={null} artifactPaneOpen={false} onToggleArtifactPane={vi.fn()} />)

    expect(screen.queryByText('tools')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'open workspace' })).not.toBeInTheDocument()
  })
})
