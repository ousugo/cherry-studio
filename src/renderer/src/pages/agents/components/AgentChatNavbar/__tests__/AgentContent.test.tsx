import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeSession: null as any,
  updateModel: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, disabled, onClick, type = 'button' }: any) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/components/HorizontalScrollContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/Selector', () => ({
  AgentSelector: ({ onChange, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('agent-b')}>
        select agent b
      </button>
    </div>
  ),
  ModelSelector: ({ onSelect, trigger }: any) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect({ id: 'provider:model-b' })}>
        select model b
      </button>
    </div>
  )
}))

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useUpdateAgent: () => ({ updateModel: mocks.updateModel })
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => undefined
}))

vi.mock('@renderer/hooks/agents/useSession', () => ({
  useActiveSession: () => ({ session: mocks.activeSession }),
  useUpdateSession: () => ({ updateSession: mocks.updateSession })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: { id: 'provider:model-a', name: 'Model A', providerId: 'provider' } })
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => 'Provider'
}))

vi.mock('@renderer/pages/agents/AgentSettings/shared', () => ({
  AgentLabel: ({ agent }: any) => <span>{agent.name}</span>
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

vi.mock('../SessionWorkspaceMeta', () => ({
  default: () => <span>workspace</span>
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
    mocks.updateModel.mockReset()
    mocks.updateSession.mockReset()
  })

  it('releases selection changes to the temporary session handler in draft mode', async () => {
    const onDraftAgentChange = vi.fn().mockResolvedValue(undefined)

    render(
      <AgentContent
        activeAgent={agentA}
        onOpenSettings={vi.fn()}
        artifactPaneOpen={false}
        onToggleArtifactPane={vi.fn()}
        onDraftAgentChange={onDraftAgentChange}
        draftMode
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'select agent b' }))

    await waitFor(() => expect(onDraftAgentChange).toHaveBeenCalledWith('agent-b'))
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('keeps global model mutation available in draft mode', () => {
    render(
      <AgentContent
        activeAgent={agentA}
        onOpenSettings={vi.fn()}
        artifactPaneOpen={false}
        onToggleArtifactPane={vi.fn()}
        draftMode
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'select model b' }))

    expect(mocks.updateModel).toHaveBeenCalledWith('agent-a', 'provider:model-b', { showSuccessToast: false })
  })

  it('keeps persisted session agent and model mutations available', async () => {
    mocks.activeSession = { id: 'session-1', agentId: 'agent-a', accessiblePaths: [] }

    render(
      <AgentContent
        activeAgent={agentA}
        onOpenSettings={vi.fn()}
        artifactPaneOpen={false}
        onToggleArtifactPane={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'select agent b' }))
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-1', agentId: 'agent-b' },
        { showSuccessToast: false }
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'select model b' }))
    expect(mocks.updateModel).toHaveBeenCalledWith('agent-a', 'provider:model-b', { showSuccessToast: false })
  })

  it('rebinds an unlinked persisted session when selecting an agent', async () => {
    mocks.activeSession = { id: 'session-unlinked', agentId: null, accessiblePaths: [] }

    render(
      <AgentContent
        activeAgent={null}
        onOpenSettings={vi.fn()}
        artifactPaneOpen={false}
        onToggleArtifactPane={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'select agent b' }))

    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith(
        { id: 'session-unlinked', agentId: 'agent-b' },
        { showSuccessToast: false }
      )
    )
    expect(mocks.updateModel).not.toHaveBeenCalled()
  })
})
