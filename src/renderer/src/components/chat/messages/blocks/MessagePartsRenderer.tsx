/**
 * MessagePartsRenderer — message parts renderer.
 *
 * Routes CherryMessagePart[] directly to leaf components. No intermediate
 * block conversion — each part type is rendered from its raw data.
 *
 * Grouping logic:
 * - Consecutive file parts with image mediaType → image block row
 * - Consecutive tool-* / dynamic-tool parts → ToolBlockGroup
 * - data-video parts with same filePath → video block row
 */

import { loggerService } from '@logger'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useIsActiveTurnTarget } from '@renderer/hooks/useIsActiveTurnTarget'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { FILE_TYPE } from '@renderer/types/file'
import { convertReferencesToCitationReferences, convertReferencesToCitations } from '@renderer/utils/partsToBlocks'
import type { CherryMessagePart, ContentReference, ReasoningUIPart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ErrorPartData, VideoPartData } from '@shared/data/types/uiParts'
import { isDataUIPart, isFileUIPart, isToolUIPart } from 'ai'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageAttachments from '../frame/MessageAttachments'
import MessageVideo from '../frame/MessageVideo'
import MessageTools, { canRenderMessageTool } from '../tools/MessageTools'
import { buildToolResponseFromPart, type ToolRenderItem } from '../tools/toolResponse'
import type { MessageListItem } from '../types'
import BlockErrorFallback from './BlockErrorFallback'
import CompactBlock from './CompactBlock'
import ErrorBlock from './ErrorBlock'
import ImageBlock from './ImageBlock'
import MainTextBlock from './MainTextBlock'
import { useMessageParts, useTranslationOverlayEntry } from './MessagePartsContext'
import PlaceholderBlock from './PlaceholderBlock'
import ThinkingBlock from './ThinkingBlock'
import ToolBlockGroup from './ToolBlockGroup'
import TranslationBlock from './TranslationBlock'

const logger = loggerService.withContext('MessagePartsRenderer')

// ============================================================================
// Animation shared by message block renderers.
// ============================================================================

const blockWrapperVariants: Variants = {
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, type: 'spring', bounce: 0 }
  },
  hidden: {
    opacity: 0,
    x: 10
  },
  static: {
    opacity: 1,
    x: 0,
    transition: { duration: 0 }
  }
}

const AnimatedBlockWrapper: React.FC<{ children: React.ReactNode; enableAnimation: boolean; className?: string }> = ({
  className,
  children,
  enableAnimation
}) => {
  const wrapperClassName = ['block-wrapper', className].filter(Boolean).join(' ')

  if (!enableAnimation) {
    return (
      <div className={wrapperClassName}>
        <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
      </div>
    )
  }
  return (
    <motion.div className={wrapperClassName} variants={blockWrapperVariants} initial="hidden" animate="visible">
      <ErrorBoundary fallbackComponent={BlockErrorFallback}>{children}</ErrorBoundary>
    </motion.div>
  )
}

// ============================================================================
// Props
// ============================================================================

interface Props {
  message: MessageListItem
}

// ============================================================================
// Helpers
// ============================================================================

/** Check if a part is an image file part. */
function isImageFilePart(part: CherryMessagePart): boolean {
  return isFileUIPart(part) && part.mediaType.startsWith('image/')
}

/** Extract image URL from a file part. */
function extractImageUrl(part: CherryMessagePart): string | undefined {
  if (part.type !== 'file' || !('url' in part)) return undefined
  const filePart = part as { url?: string; mediaType?: string }
  return filePart.url || undefined
}

/** Get video filePath from a data-video part. */
function getVideoFilePath(part: CherryMessagePart): string | undefined {
  if (isDataUIPart(part) && part.type === 'data-video') {
    return (part.data as VideoPartData).filePath
  }
  return undefined
}

// ============================================================================
// Part grouping
// ============================================================================

type PartEntry = { part: CherryMessagePart; index: number }
type GroupedEntry = PartEntry | PartEntry[]

function groupPartEntries(entries: readonly PartEntry[]): GroupedEntry[] {
  return entries.reduce<GroupedEntry[]>((acc, entry) => {
    const { part } = entry

    if (isImageFilePart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isImageFilePart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isToolUIPart(part)) {
      const prev = acc[acc.length - 1]
      if (Array.isArray(prev) && isToolUIPart(prev[0].part)) {
        prev.push(entry)
      } else {
        acc.push([entry])
      }
    } else if (isDataUIPart(part) && part.type === 'data-video') {
      const filePath = getVideoFilePath(part)
      const existingGroup = acc.find(
        (g) =>
          Array.isArray(g) &&
          isDataUIPart(g[0].part) &&
          g[0].part.type === 'data-video' &&
          getVideoFilePath(g[0].part) === filePath
      ) as PartEntry[] | undefined
      if (existingGroup) {
        existingGroup.push(entry)
      } else {
        acc.push([entry])
      }
    } else {
      acc.push(entry)
    }

    return acc
  }, [])
}

function isSummaryMessagePart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  if (partType === 'text') {
    return !!(part as { text?: string }).text?.trim()
  }
  if (partType === 'data-code') {
    return !!(part as { data?: { content?: string } }).data?.content?.trim()
  }
  if (partType === 'data-compact' || partType === 'data-translation') {
    return !!(part as { data?: { content?: string } }).data?.content?.trim()
  }
  return false
}

function isReasoningMessagePart(part: CherryMessagePart): boolean {
  return (part.type as string) === 'reasoning' && !!(part as ReasoningUIPart).text?.trim()
}

function isCollapsedMessagePart(part: CherryMessagePart): boolean {
  return isSummaryMessagePart(part) || isReasoningMessagePart(part)
}

function isResultPart(part: CherryMessagePart): boolean {
  const partType = part.type as string
  return isSummaryMessagePart(part) || partType === 'data-error' || partType === 'file' || partType === 'data-video'
}

function shouldCollapseAfterLastTool(part: CherryMessagePart): boolean {
  const partType = part.type as string
  return (
    isReasoningMessagePart(part) ||
    partType === 'step-start' ||
    partType === 'source-url' ||
    partType === 'data-citation'
  )
}

// ============================================================================
// Render helpers — Batch 1 stable components
// ============================================================================

/** Extract CherryProviderMetadata from a part. */
function getCherryMeta(part: CherryMessagePart): CherryProviderMetadata | undefined {
  if ('providerMetadata' in part && part.providerMetadata) {
    return part.providerMetadata.cherry as CherryProviderMetadata | undefined
  }
  return undefined
}

/**
 * Memoized adapter from `ErrorPartData` (with optional name/message/stack) to
 * the normalized `SerializedError` shape `ErrorBlock` consumes. Lives here —
 * not inline in the switch — so the normalized object's identity is tied to
 * `rawData`, not to whichever render of the parent triggered it. Keeping
 * identity stable lets `React.memo(ErrorBlock)` and the downstream `useMemo`s
 * actually do their job; an inline spread would mint a fresh object every
 * render and silently break memoization.
 */
const ErrorPartView = React.memo(function ErrorPartView({
  partId,
  rawData,
  message
}: {
  partId: string
  rawData: ErrorPartData
  message: MessageListItem
}) {
  const error = useMemo(
    () => ({
      ...rawData,
      name: rawData.name ?? null,
      message: rawData.message ?? null,
      stack: rawData.stack ?? null
    }),
    [rawData]
  )
  return <ErrorBlock partId={partId} error={error} message={message} />
})

/**
 * Render a single part directly from CherryMessagePart — no MessageBlock conversion.
 *
 * Data extraction happens HERE — leaf components receive pure view props only.
 */
function renderPart(
  part: CherryMessagePart,
  partId: string,
  message: MessageListItem,
  isStreaming: boolean,
  isTranslationOverlayActive: boolean
): React.ReactNode {
  const partType = part.type as string

  switch (partType) {
    case 'reasoning': {
      const reasoningPart = part as ReasoningUIPart
      const cherryMeta = getCherryMeta(part)
      const metadataBlock =
        'providerMetadata' in part && part.providerMetadata
          ? ((part.providerMetadata as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
          : undefined
      const thinkingMs =
        cherryMeta?.thinkingMs ??
        (typeof metadataBlock?.thinking_millsec === 'number' ? metadataBlock.thinking_millsec : 0)
      return (
        <ThinkingBlock
          key={partId}
          id={partId}
          content={reasoningPart.text || ''}
          isStreaming={reasoningPart.state === 'streaming'}
          thinkingMs={thinkingMs}
        />
      )
    }

    case 'data-compact': {
      const compactData = (part as { data: { content: string; compactedContent: string } }).data
      return (
        <CompactBlock
          key={partId}
          id={partId}
          content={compactData.content}
          compactedContent={compactData.compactedContent}
        />
      )
    }

    case 'data-translation': {
      const translationData = (part as { data: { content: string } }).data
      return (
        <TranslationBlock
          key={partId}
          id={partId}
          content={translationData.content}
          isStreaming={isStreaming || isTranslationOverlayActive}
        />
      )
    }

    case 'text': {
      const textPart = part as { text?: string }
      const cherryMeta = getCherryMeta(part)
      const citations = cherryMeta?.references
        ? convertReferencesToCitations(cherryMeta.references as ContentReference[])
        : []
      const citationReferences = cherryMeta?.references
        ? convertReferencesToCitationReferences(cherryMeta.references as ContentReference[], partId)
        : undefined
      return (
        <MainTextBlock
          key={partId}
          id={partId}
          content={textPart.text || ''}
          isStreaming={isStreaming}
          citations={citations}
          citationReferences={citationReferences}
          role={message.role}
          composer={cherryMeta?.composer}
        />
      )
    }

    case 'data-code': {
      const codeData = (part as { data: { content: string; language?: string } }).data
      const codeContent = `\`\`\`${codeData.language ?? ''}\n${codeData.content}\n\`\`\``
      return (
        <MainTextBlock key={partId} id={partId} content={codeContent} isStreaming={isStreaming} role={message.role} />
      )
    }

    case 'data-error': {
      const rawData = 'data' in part ? (part.data as ErrorPartData) : undefined
      if (!rawData) return null
      return <ErrorPartView key={partId} partId={partId} rawData={rawData} message={message} />
    }

    case 'data-video': {
      const rawData = 'data' in part ? (part.data as VideoPartData) : undefined
      if (!rawData) return null
      return <MessageVideo key={partId} url={rawData.url} filePath={rawData.filePath} />
    }

    case 'data-citation':
      // Citation data is embedded in MainTextBlock.citationReferences; no standalone render is needed.
      return null

    case 'file': {
      const filePart = part as { url?: string; mediaType?: string; filename?: string }
      if (filePart.mediaType?.startsWith('image/')) {
        const url = filePart.url
        if (!url) return null
        return <ImageBlock key={partId} images={[url]} isSingle={true} />
      }
      if (!filePart.url) {
        logger.warn('File part has no url, skipping', { filename: filePart.filename })
        return null
      }
      return (
        <MessageAttachments
          key={partId}
          file={{
            id: partId,
            name: filePart.filename || '',
            origin_name: filePart.filename || '',
            path: filePart.url.replace('file://', ''),
            size: 0,
            ext: '',
            type: FILE_TYPE.OTHER,
            created_at: message.createdAt,
            count: 0
          }}
        />
      )
    }

    case 'source-url':
    case 'step-start':
      return null

    default: {
      if (isToolUIPart(part)) {
        return renderToolPart(part, partId)
      }

      logger.warn('Unknown part type in MessagePartsRenderer', { type: partType })
      return null
    }
  }
}

const ToolPartView = React.memo(function ToolPartView({ part, partId }: { part: CherryMessagePart; partId: string }) {
  const toolResponse = useMemo(() => buildToolResponseFromPart(part, partId), [part, partId])
  if (!toolResponse) return null
  return <MessageTools toolResponse={toolResponse} />
})

function renderToolPart(part: CherryMessagePart, partId: string): React.ReactNode {
  return <ToolPartView key={partId} part={part} partId={partId} />
}

interface ToolGroupEntryShape {
  part: CherryMessagePart
  index: number
}
const ToolGroupView = React.memo(
  function ToolGroupView({ entries, messageId }: { entries: readonly ToolGroupEntryShape[]; messageId: string }) {
    const toolItems = entries.flatMap((e): ToolRenderItem[] => {
      const id = `${messageId}-part-${e.index}`
      const toolResponse = buildToolResponseFromPart(e.part, id)
      return toolResponse && canRenderMessageTool(toolResponse) ? [{ id, toolResponse }] : []
    })
    if (toolItems.length === 0) return null
    if (toolItems.length === 1) return <MessageTools toolResponse={toolItems[0].toolResponse} />
    return <ToolBlockGroup items={toolItems} />
  },
  (prev, next) => {
    if (prev.messageId !== next.messageId) return false
    if (prev.entries.length !== next.entries.length) return false
    for (let i = 0; i < prev.entries.length; i++) {
      if (prev.entries[i].part !== next.entries[i].part) return false
      if (prev.entries[i].index !== next.entries[i].index) return false
    }
    return true
  }
)

const CompletedToolHistoryGroup = React.memo(function CompletedToolHistoryGroup({
  entries,
  message,
  toolCount,
  messageCount
}: {
  entries: readonly PartEntry[]
  message: MessageListItem
  toolCount: number
  messageCount: number
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = React.useState(false)
  const contentId = React.useId()

  const groupedEntries = useMemo(() => groupPartEntries(entries), [entries])
  const summary =
    messageCount > 0
      ? t('message.tools.groupHeaderWithMessages', { toolCount, messageCount })
      : t('message.tools.groupHeader', { count: toolCount })

  return (
    <div className={`group/completed-tool-history max-w-full ${isExpanded ? 'w-full' : 'w-fit'}`}>
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        className="flex min-h-7 w-full items-center justify-start gap-1.5 rounded border-0 bg-transparent px-0 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        onClick={() => setIsExpanded((expanded) => !expanded)}>
        <ChevronDown
          size={16}
          className={`shrink-0 text-foreground-muted transition-transform duration-150 ${isExpanded ? 'rotate-180' : '-rotate-90'}`}
        />
        <span className="truncate font-normal text-[13px] text-foreground-secondary transition-colors duration-150 group-hover/completed-tool-history:text-foreground">
          {summary}
        </span>
      </button>
      {isExpanded && (
        <div
          id={contentId}
          className="mt-1.5 flex w-full flex-col gap-2 [&>.block-wrapper+.block-wrapper]:mt-0! [&>.block-wrapper:empty]:hidden [&>.block-wrapper]:mt-0! [&_.message-thought-container]:mt-0! [&_.message-thought-container]:mb-0!">
          {groupedEntries.map((entry) => renderGroupedEntry(entry, message, false, false))}
        </div>
      )}
    </div>
  )
})

function getCompletedToolHistory(
  entries: readonly PartEntry[],
  message: MessageListItem,
  isProcessing: boolean
): { collapsedEntries: PartEntry[]; resultEntries: PartEntry[]; toolCount: number; messageCount: number } | null {
  if (message.role !== 'assistant' || message.status !== 'success' || isProcessing) return null

  let lastToolIndex = -1
  for (let index = entries.length - 1; index >= 0; index--) {
    if (isToolUIPart(entries[index].part)) {
      lastToolIndex = index
      break
    }
  }

  if (lastToolIndex < 0 || lastToolIndex === entries.length - 1) return null

  let collapsedEndIndex = lastToolIndex
  for (let index = lastToolIndex + 1; index < entries.length; index++) {
    if (!shouldCollapseAfterLastTool(entries[index].part)) break
    collapsedEndIndex = index
  }

  const collapsedEntries = entries.slice(0, collapsedEndIndex + 1)
  const resultEntries = entries.slice(collapsedEndIndex + 1)
  if (!resultEntries.some((entry) => isResultPart(entry.part))) return null

  const toolCount = collapsedEntries.filter((entry) => isToolUIPart(entry.part)).length
  if (toolCount === 0) return null

  return {
    collapsedEntries,
    resultEntries,
    toolCount,
    messageCount: collapsedEntries.filter((entry) => isCollapsedMessagePart(entry.part)).length
  }
}

function renderGroupedEntry(
  entry: GroupedEntry,
  message: MessageListItem,
  isStreaming: boolean,
  isTranslationOverlayActive: boolean
): React.ReactNode {
  if (Array.isArray(entry)) {
    const groupKey = entry.map((e) => `${message.id}-part-${e.index}`).join('-')
    const firstPart = entry[0].part

    if (isImageFilePart(firstPart)) {
      const images = entry.map((e) => extractImageUrl(e.part)).filter(Boolean) as string[]
      if (images.length === 0) return null

      if (images.length === 1) {
        return (
          <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
            <ImageBlock images={images} isSingle={true} />
          </AnimatedBlockWrapper>
        )
      }
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxWidth: '100%' }}>
            {images.map((src, i) => (
              <ImageBlock key={`${groupKey}-img-${i}`} images={[src]} isSingle={false} />
            ))}
          </div>
        </AnimatedBlockWrapper>
      )
    }

    if (isToolUIPart(firstPart)) {
      if (
        !entry.some((e) => {
          const toolResponse = buildToolResponseFromPart(e.part, `${message.id}-part-${e.index}`)
          return toolResponse && canRenderMessageTool(toolResponse)
        })
      )
        return null

      const stableGroupKey = `tool-group-${message.id}-part-${entry[0].index}`
      return (
        <AnimatedBlockWrapper key={stableGroupKey} enableAnimation={isStreaming}>
          <ToolGroupView entries={entry} messageId={message.id} />
        </AnimatedBlockWrapper>
      )
    }

    if (isDataUIPart(firstPart) && firstPart.type === 'data-video') {
      const firstEntry = entry[0]
      const partId = `${message.id}-part-${firstEntry.index}`
      return (
        <AnimatedBlockWrapper key={groupKey} enableAnimation={isStreaming}>
          {renderPart(firstEntry.part, partId, message, isStreaming, isTranslationOverlayActive)}
        </AnimatedBlockWrapper>
      )
    }

    return null
  }

  const partId = `${message.id}-part-${entry.index}`
  const rendered = renderPart(entry.part, partId, message, isStreaming, isTranslationOverlayActive)
  if (!rendered) return null

  return (
    <AnimatedBlockWrapper
      key={partId}
      enableAnimation={isStreaming}
      className={isReasoningMessagePart(entry.part) ? 'message-thought-wrapper' : undefined}>
      {rendered}
    </AnimatedBlockWrapper>
  )
}

// ============================================================================
// Main component
// ============================================================================

const MessagePartsRenderer: React.FC<Props> = ({ message }) => {
  const messageParts = useMessageParts(message.id)
  const { isPending: isTopicStreaming } = useTopicStreamStatus(message.topicId)
  const isStreaming = isTopicStreaming && message.status === 'pending'
  const isTranslationOverlayActive = useTranslationOverlayEntry(message.id) !== undefined

  // Beat loader visible only when THIS specific message is the active turn
  // target. The identity predicate lives in `useIsActiveTurnTarget` so
  // consumers do not over-scope topic-level stream status to user messages.
  const isProcessing = useIsActiveTurnTarget(message)

  const partEntries = useMemo(() => messageParts.map((part, index) => ({ part, index })), [messageParts])
  const completedToolHistory = useMemo(
    () => getCompletedToolHistory(partEntries, message, isProcessing),
    [partEntries, message, isProcessing]
  )
  const visibleEntries = completedToolHistory?.resultEntries ?? partEntries

  const grouped = useMemo(() => {
    if (visibleEntries.length === 0) return []
    return groupPartEntries(visibleEntries)
  }, [visibleEntries])

  // No parts to render — normal for user messages (content is in message text, not parts)
  // But if the message is processing (pending/streaming), show the loading placeholder
  if (messageParts.length === 0) {
    if (isProcessing) {
      return (
        <AnimatePresence mode="sync">
          <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
            <PlaceholderBlock isProcessing={true} />
          </AnimatedBlockWrapper>
        </AnimatePresence>
      )
    }
    return null
  }

  return (
    <AnimatePresence mode="sync">
      {completedToolHistory && (
        <AnimatedBlockWrapper key={`completed-tool-history-${message.id}`} enableAnimation={false}>
          <CompletedToolHistoryGroup
            entries={completedToolHistory.collapsedEntries}
            message={message}
            toolCount={completedToolHistory.toolCount}
            messageCount={completedToolHistory.messageCount}
          />
        </AnimatedBlockWrapper>
      )}
      {grouped.map((entry) => {
        return renderGroupedEntry(entry, message, isStreaming, isTranslationOverlayActive)
      })}
      {isProcessing && (
        <AnimatedBlockWrapper key="message-loading-placeholder" enableAnimation={true}>
          <PlaceholderBlock isProcessing={true} />
        </AnimatedBlockWrapper>
      )}
    </AnimatePresence>
  )
}

export default React.memo(MessagePartsRenderer)
