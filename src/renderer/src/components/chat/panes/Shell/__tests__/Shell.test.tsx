import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HorizontalScrollContainer: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="shell-tab-scroll-container" className={className}>
      {children}
    </div>
  ),
  TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="shell-tabs-list" className={className}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div data-testid="shell-tooltip" data-content={typeof content === 'string' ? content : undefined}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    active,
    children,
    tone,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; children: ReactNode; tone?: string }) => (
    <button type="button" data-active={active || undefined} data-tone={tone} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/chat', () => ({
  ARTIFACT_RIGHT_PANE_CACHE_KEY: 'ui.chat.artifact_pane.width',
  ARTIFACT_RIGHT_PANE_DEFAULT_WIDTH: 460,
  ARTIFACT_RIGHT_PANE_MAX_WIDTH: 720,
  ARTIFACT_RIGHT_PANE_MIN_WIDTH: 360,
  RightPaneHost: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/Icons', () => ({
  RightSidebarCollapseIcon: () => <span data-testid="collapse-icon" />,
  RightSidebarExpandIcon: () => <span data-testid="expand-icon" />
}))

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>
  },
  useReducedMotion: () => false
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { Shell, useShellActions, useShellState } from '../Shell'

function CloseShellButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={() => actions.close()}>
      close shell
    </button>
  )
}

function OpenTraceButton() {
  const actions = useShellActions()

  return (
    <button type="button" onClick={() => actions.openTab('trace')}>
      open trace
    </button>
  )
}

function ShellStateSnapshot() {
  const state = useShellState()

  return <div data-testid="shell-state">{`${state.open ? 'open' : 'closed'}:${state.activeTab}`}</div>
}

describe('Shell.Toggle', () => {
  it('keeps the same toggle button while swapping icons across states', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(toggle).toHaveAttribute('data-tone', 'conversation')
    expect(toggle).not.toHaveAttribute('data-active')
    expect(screen.getByTestId('shell-tooltip')).toHaveAttribute('data-content', 'common.open_sidebar')
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'common.close_sidebar' })).toBe(toggle)
    expect(toggle).toHaveAttribute('data-state', 'open')
    expect(toggle).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('shell-tooltip')).toHaveAttribute('data-content', 'common.close_sidebar')
    expect(screen.getByTestId('collapse-icon')).toBeInTheDocument()
  })

  it('does not open the pane when disabled', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" disabled />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument()
  })

  it('can close the open pane through shell actions', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
        <CloseShellButton />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'common.open_sidebar' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'open')

    fireEvent.click(screen.getByRole('button', { name: 'close shell' }))
    expect(toggle).toHaveAttribute('data-state', 'closed')
  })

  it('closes the pane directly without switching tabs when another tab is active', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" />
        <OpenTraceButton />
        <ShellStateSnapshot />
      </Shell>
    )

    fireEvent.click(screen.getByRole('button', { name: 'open trace' }))

    const toggle = screen.getByRole('button', { name: 'common.close_sidebar' })
    expect(toggle).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('shell-state')).toHaveTextContent('open:trace')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('shell-state')).toHaveTextContent('closed:trace')
  })
})

describe('Shell.TabList', () => {
  it('reserves the fixed toggle slot only outside maximized mode', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Tabs>
          <Shell.TabList>
            <Shell.Tab value="files">Files</Shell.Tab>
          </Shell.TabList>
        </Shell.Tabs>
      </Shell>
    )

    const tabList = screen.getByTestId('shell-tab-list')
    const scrollContainer = screen.getByTestId('shell-tab-scroll-container')
    const tabsList = screen.getByTestId('shell-tabs-list')

    expect(tabList).toHaveClass('pr-11')
    expect(scrollContainer).toHaveClass('min-w-0', 'flex-1')
    expect(tabsList).not.toHaveClass('overflow-x-auto')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    const minimizeButton = screen.getByRole('button', { name: 'common.minimize' })

    expect(minimizeButton).toHaveAttribute('data-tone', 'conversation')
    expect(minimizeButton).toHaveAttribute('aria-pressed', 'true')
    expect(minimizeButton).not.toHaveAttribute('data-active')
    expect(minimizeButton.querySelector('svg')).not.toHaveAttribute('width', '15')
    expect(tabList).not.toHaveClass('pr-11')
    expect(tabList).toHaveClass('px-3')
  })
})
