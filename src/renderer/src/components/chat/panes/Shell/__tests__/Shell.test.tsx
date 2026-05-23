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
  TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button type="button" {...props}>
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

import { Shell } from '../Shell'

describe('Shell.Toggle', () => {
  it('keeps the same toggle button while swapping icons across states', () => {
    render(
      <Shell defaultTab="files">
        <Shell.Toggle tab="files" label="Files" />
      </Shell>
    )

    const toggle = screen.getByRole('button', { name: 'Files' })

    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Files' })).toBe(toggle)
    expect(toggle).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('collapse-icon')).toBeInTheDocument()
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

    expect(tabList).toHaveClass('pr-11')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))

    expect(tabList).not.toHaveClass('pr-11')
    expect(tabList).toHaveClass('px-3')
  })
})
