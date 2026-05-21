import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>
  }
}))

vi.mock('../../AgentSidePanelDrawer', () => ({
  default: { show: vi.fn() }
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
  it('keeps agent page tools in the navbar', () => {
    render(<AgentContent activeAgent={agentA} tools={<span>files</span>} />)

    expect(screen.getByText('tools')).toBeInTheDocument()
    expect(screen.queryByText('select agent b')).not.toBeInTheDocument()
    expect(screen.queryByText('select model b')).not.toBeInTheDocument()
  })

  it('does not render the workspace opener in the navbar', () => {
    render(<AgentContent activeAgent={agentA} tools={<span>files</span>} />)

    expect(screen.queryByRole('button', { name: 'open workspace' })).not.toBeInTheDocument()
  })

  it('hides agent-scoped navbar actions when no agent is active', () => {
    render(<AgentContent activeAgent={null} tools={<span>files</span>} />)

    expect(screen.queryByText('tools')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'open workspace' })).not.toBeInTheDocument()
  })
})
