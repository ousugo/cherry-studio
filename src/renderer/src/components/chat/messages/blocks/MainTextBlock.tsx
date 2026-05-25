import { Flex } from '@cherrystudio/ui'
import type { MarkdownSource } from '@cherrystudio/ui/composites/markdown'
import { useSmoothStream } from '@renderer/hooks/useSmoothStream'
import type { Citation, Model } from '@renderer/types'
import { determineCitationSource, withCitationTags } from '@renderer/utils/citation'
import type { CitationReferenceView } from '@renderer/utils/partsToBlocks'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import type { ComposerMessageSnapshot, ComposerMessageToken } from '@shared/data/types/uiParts'
import { Bot, Boxes, Code2, FileText, Globe2, Monitor, Wrench } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'

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
  reference: Globe2,
  skill: Wrench
} satisfies Record<ComposerMessageToken['kind'], React.ComponentType<{ size?: number; className?: string }>>

function ComposerMessageTokenChip({ token }: { token: ComposerMessageToken }) {
  const Icon = composerTokenIcon[token.kind]

  return (
    <span
      className="mx-0.5 inline-flex max-w-52 select-none items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 align-baseline text-foreground text-sm leading-5"
      data-composer-token-kind={token.kind}
      title={token.description ?? token.label}>
      <Icon size={14} className="shrink-0 text-foreground-muted" />
      <span className="truncate">{token.label}</span>
    </span>
  )
}

function renderComposerMessageContent(content: string, composer: ComposerMessageSnapshot) {
  const tokens = composer.tokens
    .filter((token) => token.label)
    .sort((a, b) => a.textOffset - b.textOffset || a.index - b.index)
  const nodes: React.ReactNode[] = []
  let cursor = 0

  tokens.forEach((token) => {
    const offset = Math.max(0, Math.min(content.length, token.textOffset))
    if (offset > cursor) {
      nodes.push(content.slice(cursor, offset))
      cursor = offset
    }

    nodes.push(<ComposerMessageTokenChip key={`${token.id}:${token.index}`} token={token} />)

    if (token.promptText && content.slice(offset, offset + token.promptText.length) === token.promptText) {
      cursor = Math.max(cursor, offset + token.promptText.length)
    }
  })

  if (cursor < content.length) {
    nodes.push(content.slice(cursor))
  }

  return nodes
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
      {role === 'user' && !renderInputMessageAsMarkdown ? (
        <p className="markdown" style={{ whiteSpace: 'pre-wrap' }}>
          {composer?.tokens.length ? renderComposerMessageContent(content, composer) : content}
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
