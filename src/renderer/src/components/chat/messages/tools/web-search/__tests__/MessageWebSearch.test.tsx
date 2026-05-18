import type { NormalToolResponse } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageWebSearchToolTitle } from '../MessageWebSearch'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.websearch.fetch_empty') return 'No search results found'
      if (key === 'message.websearch.fetch_complete') return `${params?.count} search results`
      return key
    }
  })
}))

vi.mock('lucide-react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    Search: () => <span data-testid="search-icon" />
  }
})

describe('MessageWebSearchToolTitle', () => {
  it('uses a natural empty-result label without horizontal padding', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web__search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: []
          } as NormalToolResponse
        }
      />
    )

    const title = screen.getByText('No search results found').closest('span')
    expect(title).toHaveClass('flex items-center gap-1 py-1.25 text-foreground-secondary')
    expect(title).not.toHaveClass('p-1.25')
    expect(screen.getByTestId('search-icon')).toBeInTheDocument()
  })

  it('keeps the result count label when results are present', () => {
    render(
      <MessageWebSearchToolTitle
        toolResponse={
          {
            id: 'tool-call-1',
            toolCallId: 'tool-call-1',
            tool: { id: 'web-search', name: 'web__search', type: 'builtin' },
            status: 'done',
            arguments: { query: 'Cherry Studio' },
            response: [{ id: 1, title: 'Cherry Studio', url: 'https://cherry-ai.com', content: 'Cherry Studio' }]
          } as NormalToolResponse
        }
      />
    )

    expect(screen.getByText('1 search results')).toBeInTheDocument()
  })
})
