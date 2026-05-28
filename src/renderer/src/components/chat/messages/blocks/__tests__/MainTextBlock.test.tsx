import type { Citation, Model } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ComposerMessageSnapshot } from '@shared/data/types/uiParts'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MainTextBlock from '../MainTextBlock'

// Mock dependencies
const mockRenderConfig = vi.hoisted(() => ({
  renderInputMessageAsMarkdown: false
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig,
  useOptionalMessageListActions: () => undefined
}))

// Mock citation utilities
vi.mock('@renderer/utils/citation', () => ({
  withCitationTags: vi.fn((content: string, citations: any[]) => {
    if (citations.length > 0) {
      return `${content} [processed-citations]`
    }
    return content
  }),
  determineCitationSource: vi.fn((citationReferences: any[]) => {
    if (citationReferences?.length) {
      const validReference = citationReferences.find((ref) => ref.citationBlockSource)
      return validReference?.citationBlockSource
    }
    return undefined
  })
}))

// Mock Markdown component
vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: ({ block, postProcess, components }: any) => {
    const content = postProcess ? postProcess(block.content) : block.content
    const tokenPlaceholderPattern =
      /<span data-composer-token-index="(\d+)" data-composer-token-block="([^"]+)"><\/span>/g
    const nodes: any[] = []
    let cursor = 0
    for (const match of content.matchAll(tokenPlaceholderPattern)) {
      const index = match.index ?? 0
      if (index > cursor) nodes.push(content.slice(cursor, index))
      const tokenIndex = match[1]
      const tokenBlock = match[2]
      nodes.push(
        components?.span?.({
          key: `token-${tokenIndex}`,
          dataComposerTokenIndex: tokenIndex,
          dataComposerTokenBlock: tokenBlock,
          children: null
        }) ?? match[0]
      )
      cursor = index + match[0].length
    }
    if (cursor < content.length) nodes.push(content.slice(cursor))

    return (
      <div data-testid="mock-markdown" data-content={content}>
        Markdown: {nodes}
      </div>
    )
  }
}))

describe('MainTextBlock', () => {
  let mockWithCitationTags: any
  let mockDetermineCitationSource: any

  beforeEach(async () => {
    vi.clearAllMocks()

    const { withCitationTags, determineCitationSource } = await import('@renderer/utils/citation')
    mockWithCitationTags = withCitationTags as any
    mockDetermineCitationSource = determineCitationSource as any

    mockRenderConfig.renderInputMessageAsMarkdown = false
  })

  // Helper functions
  const renderMainTextBlock = (props: {
    id?: string
    content: string
    isStreaming?: boolean
    citations?: Citation[]
    citationReferences?: { citationBlockId?: string; citationBlockSource?: any }[]
    role: 'user' | 'assistant'
    mentions?: Model[]
    composer?: ComposerMessageSnapshot
  }) => {
    return render(
      <MainTextBlock
        id={props.id ?? 'test-block-1'}
        content={props.content}
        isStreaming={props.isStreaming ?? false}
        citations={props.citations}
        citationReferences={props.citationReferences}
        role={props.role}
        mentions={props.mentions}
        composer={props.composer}
      />
    )
  }

  const getRenderedMarkdown = () => screen.queryByTestId('mock-markdown')
  const getRenderedPlainText = () => screen.queryByRole('paragraph')

  describe('basic rendering', () => {
    it('should render in markdown mode for assistant messages', () => {
      renderMainTextBlock({ content: 'Assistant response', role: 'assistant' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: Assistant response')).toBeInTheDocument()
      expect(getRenderedPlainText()).not.toBeInTheDocument()
    })

    it('should render in plain text mode for user messages when setting disabled', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({ content: 'User message\nWith line breaks', role: 'user' })

      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedPlainText()!.textContent).toBe('User message\nWith line breaks')
      expect(getRenderedMarkdown()).not.toBeInTheDocument()

      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveStyle({ whiteSpace: 'pre-wrap' })
    })

    it('should render user messages as markdown when setting enabled', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({ content: 'User **bold** content', role: 'user' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: User **bold** content')).toBeInTheDocument()
    })

    it('should preserve complex formatting in plain text mode', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      const complexContent = `Line 1
  Indented line
**Bold not parsed**
- List not parsed`

      renderMainTextBlock({ content: complexContent, role: 'user' })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe(complexContent)
      expect(textElement).toHaveClass('markdown')
    })

    it('should handle empty content gracefully', () => {
      expect(() => {
        renderMainTextBlock({ content: '', role: 'assistant' })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })

    it('should render composer tokens as inline chips without leaking hidden prompt text', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Open src/chat.ts now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              index: 0,
              textOffset: 5,
              promptText: 'src/chat.ts'
            }
          ]
        }
      })

      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveTextContent('Open chat.ts now')
      expect(textElement).not.toHaveTextContent('src/chat.ts')
      expect(textElement.querySelector('[data-composer-token-kind="file"]')).toBeInTheDocument()
    })

    it('should render skill composer tokens with their own visual treatment', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Use the pdf skill.',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'skill:pdf',
              kind: 'skill',
              label: 'pdf',
              description: 'Read and analyze PDFs',
              index: 0,
              textOffset: 0,
              promptText: 'Use the pdf skill.'
            }
          ]
        }
      })

      const token = getRenderedPlainText()!.querySelector('[data-composer-token-kind="skill"]')
      expect(token).toBeInTheDocument()
      expect(token).toHaveClass('border-0', 'bg-transparent', 'text-primary')
      expect(token?.querySelector('svg')).toHaveClass('text-primary')
    })

    it('should render composer tokens while preserving markdown for user text segments', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: 'Use the find-skills skill. **hello**',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'skill:find-skills',
              kind: 'skill',
              label: 'find-skills',
              index: 0,
              textOffset: 0,
              promptText: 'Use the find-skills skill.'
            }
          ]
        }
      })

      const markdown = getRenderedMarkdown()!
      expect(markdown).toBeInTheDocument()
      expect(markdown).toHaveAttribute(
        'data-content',
        '<span data-composer-token-index="0" data-composer-token-block="test-block-1"></span> **hello**'
      )
      expect(markdown).toHaveTextContent('Markdown: find-skills **hello**')
      expect(markdown).not.toHaveTextContent('Use the find-skills skill.')
      expect(markdown.querySelector('[data-composer-token-kind="skill"]')).toBeInTheDocument()
    })

    it('should ignore legacy model composer tokens in user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Ask now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'model-1',
              kind: 'model',
              label: 'GPT',
              index: 0,
              textOffset: 0
            }
          ]
        }
      })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe('Ask now')
      expect(textElement).not.toHaveTextContent('GPT')
      expect(textElement.querySelector('[data-composer-token-kind="model"]')).not.toBeInTheDocument()
    })

    it('should ignore prompt-variable composer metadata in user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Route from Shanghai',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'prompt-variable:0:from',
              kind: 'promptVariable',
              label: 'from',
              index: 0,
              textOffset: 11,
              promptText: 'Shanghai'
            }
          ]
        } as never
      })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe('Route from Shanghai')
      expect(textElement.querySelector('[data-composer-token-kind="promptVariable"]')).not.toBeInTheDocument()
    })
  })

  describe('mentions functionality', () => {
    it('should display model mentions when provided', () => {
      const mentions = [
        { id: 'model-1', name: 'deepseek-r1', provider: 'test' } as Model,
        { id: 'model-2', name: 'claude-sonnet-4', provider: 'test' } as Model
      ]

      renderMainTextBlock({ content: 'Content with mentions', role: 'assistant', mentions })

      expect(screen.getByText('@deepseek-r1')).toBeInTheDocument()
      expect(screen.getByText('@claude-sonnet-4')).toBeInTheDocument()
    })

    it('should not display mentions when none provided', () => {
      renderMainTextBlock({ content: 'No mentions content', role: 'assistant', mentions: [] })
      expect(screen.queryAllByText(/@/)).toHaveLength(0)
    })

    it('should style mentions correctly for user visibility', () => {
      const mentions = [{ id: 'model-1', name: 'Test Model', provider: 'test' } as Model]

      renderMainTextBlock({ content: 'Styled mentions test', role: 'assistant', mentions })

      const mentionElement = screen.getByText('@Test Model')
      expect(mentionElement).toHaveClass('text-primary')
    })
  })

  describe('citation processing', () => {
    it('should process content with citations when all conditions are met', () => {
      const citations: Citation[] = [
        { number: 1, url: 'https://example.com', title: 'Example Citation', content: 'Citation content' }
      ]
      const citationReferences = [{ citationBlockSource: WEB_SEARCH_SOURCE.OPENAI }]

      renderMainTextBlock({
        content: 'Content with citation [1]',
        role: 'assistant',
        citations,
        citationReferences
      })

      expect(mockDetermineCitationSource).toHaveBeenCalledWith(citationReferences)
      expect(mockWithCitationTags).toHaveBeenCalledWith(
        'Content with citation [1]',
        citations,
        WEB_SEARCH_SOURCE.OPENAI
      )
      expect(screen.getByText('Markdown: Content with citation [1] [processed-citations]')).toBeInTheDocument()
    })

    it('should skip citation processing when no citationReferences', () => {
      renderMainTextBlock({ content: 'Content [1]', role: 'assistant', citations: [] })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: Content [1]')).toBeInTheDocument()
      expect(mockWithCitationTags).not.toHaveBeenCalled()
    })

    it('should skip citation processing when no citations data', () => {
      const citationReferences = [{ citationBlockSource: 'DEFAULT' as any }]

      renderMainTextBlock({
        content: 'Content [1]',
        role: 'assistant',
        citations: [],
        citationReferences
      })

      expect(screen.getByText('Markdown: Content [1]')).toBeInTheDocument()
      expect(mockWithCitationTags).not.toHaveBeenCalled()
    })

    it('should handle multiple citations gracefully', () => {
      const citations: Citation[] = [
        { number: 1, url: 'https://first.com', title: 'First' },
        { number: 2, url: 'https://second.com', title: 'Second' }
      ]
      const citationReferences = [{ citationBlockSource: 'DEFAULT' as any }]

      expect(() => {
        renderMainTextBlock({
          content: 'Multiple citations [1] and [2]',
          role: 'assistant',
          citations,
          citationReferences
        })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })

  describe('settings integration', () => {
    it('should respond to markdown rendering setting changes', () => {
      // Test with markdown enabled
      mockRenderConfig.renderInputMessageAsMarkdown = true
      const { unmount } = renderMainTextBlock({ content: 'Settings test content', role: 'user' })
      expect(getRenderedMarkdown()).toBeInTheDocument()
      unmount()

      // Test with markdown disabled
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({ content: 'Settings test content', role: 'user' })
      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedMarkdown()).not.toBeInTheDocument()
    })
  })

  describe('robustness', () => {
    it('should handle null and undefined values gracefully', () => {
      expect(() => {
        renderMainTextBlock({
          content: 'Null safety test',
          role: 'assistant',
          mentions: undefined,
          citations: undefined,
          citationReferences: undefined
        })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })
})
