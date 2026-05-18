import { loggerService } from '@logger'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArtifactPane from '../ArtifactPane'

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children, content }: PropsWithChildren<{ content: string }>) => (
    <div data-testid="tooltip" data-content={content}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ rows }: { rows?: number }) => <div data-testid="loading-state" data-rows={rows} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'agent.preview_pane.items' ? `${options?.count ?? 0} localized items` : key
  })
}))

describe('ArtifactPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          listDirectory: mocks.listDirectory
        }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the ready empty state when no workspace path is available', () => {
    render(<ArtifactPane onClose={vi.fn()} />)

    expect(mocks.listDirectory).not.toHaveBeenCalled()
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.description')
  })

  it('lists the workspace directory with the expected options', async () => {
    mocks.listDirectory.mockResolvedValueOnce(['README.md', 'src'])

    render(<ArtifactPane workspacePath="/tmp/workspace" onClose={vi.fn()} />)

    expect(screen.getByTestId('loading-state')).toHaveAttribute('data-rows', '4')

    await waitFor(() =>
      expect(mocks.listDirectory).toHaveBeenCalledWith('/tmp/workspace', {
        recursive: false,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true
      })
    )
    expect(screen.getByTitle('/tmp/workspace')).toHaveTextContent('/tmp/workspace')
    expect(screen.getByText('2 localized items')).toBeInTheDocument()
  })

  it('logs and displays directory listing errors', async () => {
    const error = new Error('Permission denied')
    const errorSpy = vi.spyOn(loggerService, 'error').mockImplementation(() => undefined)
    mocks.listDirectory.mockRejectedValueOnce(error)

    render(<ArtifactPane workspacePath="/tmp/workspace" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Permission denied')).toBeInTheDocument())
    expect(errorSpy).toHaveBeenCalledWith('Failed to list directory: /tmp/workspace', error)
  })

  it('renders header tool buttons and calls onClose from the close button', () => {
    const onClose = vi.fn()

    render(<ArtifactPane onClose={onClose} />)

    for (const label of [
      'agent.preview_pane.file_tree',
      'agent.preview_pane.preview',
      'agent.preview_pane.code',
      'agent.preview_pane.refresh',
      'agent.preview_pane.maximize',
      'agent.preview_pane.close'
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: 'agent.preview_pane.close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
