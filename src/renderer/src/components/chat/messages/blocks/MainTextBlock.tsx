import { Flex, NormalTooltip } from '@cherrystudio/ui'
import type { MarkdownSource } from '@cherrystudio/ui/composites/markdown'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/chat/utils/quoteToken'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { Citation, Model } from '@renderer/types'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import { getDisplayComposerTokens } from '@renderer/utils/messageUtils/composerTokens'
import type { CitationReferenceView } from '@renderer/utils/partsToBlocks'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import type { ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { Bot, Boxes, Code2, FileText, Globe2, Monitor, TextQuote, Wrench, Zap } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Components } from 'streamdown'

import ChatMarkdown from '../markdown/ChatMarkdown'
import { useMessageRenderConfig } from '../MessageListProvider'
import CitationsList from './CitationsList'

interface Props {
  id: string
  content: string
  isStreaming: boolean
  citations?: Citation[]
  citationReferences?: CitationReferenceView[]
  mentions?: Model[]
  role: CherryUIMessage['role']
  composer?: ComposerMessageSnapshot
}

const composerTokenIcon = {
  command: Code2,
  environment: Monitor,
  file: FileText,
  knowledge: Boxes,
  mcpPrompt: Wrench,
  mcpResource: Globe2,
  model: Bot,
  quote: TextQuote,
  reference: Globe2,
  skill: Zap
} satisfies Record<ComposerMessageToken['kind'], React.ComponentType<{ size?: number; className?: string }>>

const skillComposerTokenClassName = 'border-0 bg-transparent text-primary'
const COMPOSER_TOKEN_MARKDOWN_ATTR = 'data-composer-token-index'
const COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR = 'data-composer-token-block'

function ComposerMessageTokenChip({ token }: { token: ComposerMessageToken }) {
  const Icon = composerTokenIcon[token.kind]
  const title = token.kind === 'quote' ? undefined : (token.description ?? token.label)
  const isSkill = token.kind === 'skill'

  const chip = (
    <span
      className={cn(
        'mx-0.5 inline-flex max-w-52 select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-sm leading-5',
        isSkill ? skillComposerTokenClassName : 'border-border bg-muted text-foreground'
      )}
      data-composer-token-kind={token.kind}
      title={title}>
      <Icon size={14} className={cn('shrink-0', isSkill ? 'text-primary' : 'text-foreground-muted')} />
      <span className="truncate">{token.label}</span>
    </span>
  )
  const quoteTooltipContent =
    token.kind === 'quote' ? getQuoteTooltipContent(token.description, token.promptText) : undefined

  if (!quoteTooltipContent) return chip

  return (
    <NormalTooltip
      content={<div className={QUOTE_TOOLTIP_BODY_CLASS_NAME}>{quoteTooltipContent}</div>}
      side="top"
      sideOffset={6}
      delayDuration={300}
      contentProps={{ className: QUOTE_TOOLTIP_CONTENT_CLASS_NAME }}>
      {chip}
    </NormalTooltip>
  )
}

function renderComposerMessageContent(content: string, composer: ComposerMessageSnapshot) {
  const tokens = getDisplayComposerTokens(composer)
  const nodes: React.ReactNode[] = []
  let cursor = 0

  tokens.forEach((token) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    const promptText = token.promptText
    const promptTextMatches = !!promptText && content.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    if (offset > cursor) {
      nodes.push(content.slice(cursor, offset))
      cursor = offset
    }

    nodes.push(<ComposerMessageTokenChip key={`${token.id}:${token.index}`} token={token} />)

    if (promptTextMatches) {
      cursor = Math.max(cursor, offset + promptText.length)
    }
  })

  if (cursor < content.length) {
    nodes.push(content.slice(cursor))
  }

  return nodes
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getComposerMarkdownTokenPlaceholder(index: number, blockId: string) {
  return `<span ${COMPOSER_TOKEN_MARKDOWN_ATTR}="${index}" ${COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR}="${escapeHtmlAttribute(blockId)}"></span>`
}

function buildComposerMessageMarkdownContent(content: string, composer: ComposerMessageSnapshot, blockId: string) {
  const tokens = getDisplayComposerTokens(composer)
  let markdown = ''
  let cursor = 0

  tokens.forEach((token, index) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    const promptText = token.promptText
    const promptTextMatches = !!promptText && content.slice(offset, offset + promptText.length) === promptText
    if (promptText && !promptTextMatches) return

    if (offset > cursor) {
      markdown += content.slice(cursor, offset)
      cursor = offset
    }

    markdown += getComposerMarkdownTokenPlaceholder(index, blockId)

    if (promptTextMatches) {
      cursor = Math.max(cursor, offset + promptText.length)
    }
  })

  if (cursor < content.length) {
    markdown += content.slice(cursor)
  }

  return { markdown, tokens }
}

const MainTextBlock: React.FC<Props> = ({
  id,
  content,
  isStreaming,
  citations = [],
  citationReferences,
  role,
  mentions = [],
  composer
}) => {
  const { renderInputMessageAsMarkdown } = useMessageRenderConfig()
  const shouldRenderComposerTokens = role === 'user' && !!composer?.tokens.length

  const [smoothedContent, setSmoothedContent] = useState(content)
  const { update: updateSmoothStream } = useSmoothStream({
    onUpdate: setSmoothedContent,
    streamDone: !isStreaming,
    initialText: content
  })
  useEffect(() => {
    updateSmoothStream(content, !isStreaming)
  }, [content, isStreaming, updateSmoothStream])

  const block: MarkdownSource = {
    id,
    content: smoothedContent,
    status: isStreaming ? 'streaming' : 'success'
  }

  const processContent = useCallback(
    (rawText: string) => {
      if (!citationReferences?.length || citations.length === 0) return rawText
      const sourceType = determineCitationSource(citationReferences)
      return withCitationTags(rawText, citations, sourceType)
    },
    [citationReferences, citations]
  )
  const composerMarkdownContent = useMemo(() => {
    if (!shouldRenderComposerTokens || !renderInputMessageAsMarkdown || !composer) return undefined
    return buildComposerMessageMarkdownContent(content, composer, id)
  }, [composer, content, id, renderInputMessageAsMarkdown, shouldRenderComposerTokens])
  const composerMarkdownComponents = useMemo<Partial<Components>>(
    () => ({
      span: ({ children, ...props }) => {
        const rawProps = props as Record<string, unknown>
        const rawIndex = rawProps[COMPOSER_TOKEN_MARKDOWN_ATTR] ?? rawProps.dataComposerTokenIndex
        const rawBlock = rawProps[COMPOSER_TOKEN_MARKDOWN_BLOCK_ATTR] ?? rawProps.dataComposerTokenBlock
        const tokenIndex = typeof rawIndex === 'string' ? Number.parseInt(rawIndex, 10) : NaN
        const token =
          rawBlock === id && Number.isFinite(tokenIndex) ? composerMarkdownContent?.tokens[tokenIndex] : undefined
        if (token) return <ComposerMessageTokenChip token={token} />

        return <span {...props}>{children}</span>
      }
    }),
    [composerMarkdownContent?.tokens, id]
  )

  return (
    <>
      {/* Render mentions associated with the message */}
      {mentions && mentions.length > 0 && (
        <Flex className="mb-2.5 flex-wrap gap-2">
          {mentions.map((m) => (
            <span key={createUniqueModelId(m.provider, m.id)} className="text-primary">
              {'@' + m.name}
            </span>
          ))}
        </Flex>
      )}
      {composerMarkdownContent ? (
        <ChatMarkdown
          block={{ ...block, content: composerMarkdownContent.markdown }}
          components={composerMarkdownComponents}
          postProcess={processContent}
        />
      ) : role === 'user' && (shouldRenderComposerTokens || !renderInputMessageAsMarkdown) ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {shouldRenderComposerTokens ? renderComposerMessageContent(content, composer) : content}
        </p>
      ) : (
        <ChatMarkdown block={block} postProcess={processContent} />
      )}
      {/* Parts data stores citation refs per text part, so the list is scoped to the text segment that produced it. */}
      {citations.length > 0 && <CitationsList citations={citations} />}
    </>
  )
}

export default React.memo(MainTextBlock)
