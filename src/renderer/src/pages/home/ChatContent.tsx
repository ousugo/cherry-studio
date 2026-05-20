import { loggerService } from '@logger'
import { ComposerContextProvider } from '@renderer/components/chat/composer/ComposerContext'
import ComposerCore from '@renderer/components/chat/composer/ComposerCore'
import ComposerDockTransitionFrame from '@renderer/components/chat/composer/ComposerDockTransitionFrame'
import { useToolApprovalComposerOverrides } from '@renderer/components/chat/composer/useToolApprovalComposerOverrides'
import ChatComposer, { ChatHomeComposer } from '@renderer/components/chat/composer/variants/ChatComposer'
import {
  RefreshProvider,
  type TranslationOverlayEntry,
  TranslationOverlayProvider,
  type TranslationOverlaySetter,
  TranslationOverlaySetterProvider
} from '@renderer/components/chat/messages/blocks'
import { MessageListInitialLoading } from '@renderer/components/chat/messages/layout/MessageListLoading'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import { ChatWriteProvider } from '@renderer/hooks/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { type ExecutionFinishEvent, useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useChatWriteActions } from './hooks/useChatWriteActions'
import { usePendingMessages } from './hooks/usePendingMessages'
import { useTopicMessagesCache } from './hooks/useTopicMessagesCache'
import { useHomeMessageListProviderValue } from './messages/homeMessageListAdapter'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('ChatContent')

export interface ChatContentFrameSlots {
  main: ReactNode
  bottomComposer?: ReactNode
  overlay?: ReactNode
}

interface Props {
  topic: Topic
  mainHeight: string
  renderFrame?: (slots: ChatContentFrameSlots) => ReactNode
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  /**
   * If the active topic is a freshly-leased temporary one, this callback
   * migrates it into SQLite (with the same id) before the first message
   * is sent. Owned by HomePage so the lease and the persist trigger live
   * on the same hook instance. `initialName` seeds a placeholder topic
   * title so the sidebar isn't blank pre-auto-name.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<void>
}

/**
 * Home chat content.
 *
 * Outer shell — waits on history to be loaded before mounting the inner
 * component (useChat seeds `initialMessages` once, at mount).
 *
 * Inner component composes three purpose-built hooks:
 *   - `useExecutionOverlay` — overlays per-execution streaming parts
 *     onto the DB-backed `uiMessages` parts map.
 *   - `useTopicMessagesCache` — optimistic SWR writes + DataApi mutation
 *     triggers for send / delete / edit / fork / setActiveNode.
 *   - `useChatWriteActions` — every write-side handler the
 *     `ChatWriteContext` provides to downstream components.
 *
 * `useChatWithHistory` stays trigger-only: `sendMessage` / `regenerate`
 * / `stop` / `setMessages` / `activeExecutions`. Its
 * `state.messages` is not rendered; chunks land in the per-execution overlay
 * and are merged into `partsByMessageId`.
 */
const ChatContent: FC<Props> = ({
  topic,
  mainHeight,
  renderFrame,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  onPersistTemporaryTopic
}) => {
  const [hasPersistedTemporaryTopic, setHasPersistedTemporaryTopic] = useState(false)
  useEffect(() => setHasPersistedTemporaryTopic(false), [topic.id])
  const isFreshTemporaryTopic = !!onPersistTemporaryTopic && !hasPersistedTemporaryTopic
  const {
    uiMessages,
    siblingsMap,
    isLoading: isHistoryLoading,
    refresh,
    activeNodeId,
    loadOlder,
    hasOlder,
    mutate: messagesCacheMutate
  } = useTopicMessages(topic.id, { fetchOnMount: !isFreshTemporaryTopic })

  if (isHistoryLoading) {
    const main = <MessageListInitialLoading />

    if (renderFrame) {
      return renderFrame({ main })
    }

    return (
      <div
        className="flex flex-1 flex-col items-center justify-center"
        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
        {main}
      </div>
    )
  }

  return (
    <ChatContentInner
      topic={topic}
      mainHeight={mainHeight}
      renderFrame={renderFrame}
      onOpenCitationsPanel={onOpenCitationsPanel}
      onTemporaryAssistantChange={onTemporaryAssistantChange}
      onNewTopic={onNewTopic}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
      isFreshTemporaryTopic={isFreshTemporaryTopic}
      onTemporaryTopicPersisted={() => setHasPersistedTemporaryTopic(true)}
      initialMessages={uiMessages}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
      loadOlder={loadOlder}
      hasOlder={hasOlder}
      messagesCacheMutate={messagesCacheMutate}
    />
  )
}

// ============================================================================
// Inner — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  isFreshTemporaryTopic: boolean
  onTemporaryTopicPersisted: () => void
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessages>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessages>['mutate']
}

const ChatContentInner: FC<InnerProps> = ({
  topic,
  mainHeight,
  renderFrame,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  onPersistTemporaryTopic,
  isFreshTemporaryTopic,
  onTemporaryTopicPersisted,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId,
  loadOlder,
  hasOlder,
  messagesCacheMutate
}) => {
  const { sendMessage, regenerate, stop, status, setMessages, activeExecutions } = useChatWithHistory(
    topic.id,
    initialMessages,
    refresh
  )

  const { pendingMessages, addPending } = usePendingMessages(topic.id, uiMessages)
  const messages = useMemo(
    () => (pendingMessages.length > 0 ? [...uiMessages, ...pendingMessages] : uiMessages),
    [pendingMessages, uiMessages]
  )

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    setMessages(uiMessages)
  }, [uiMessages, status, setMessages])

  const [translationOverlay, setTranslationOverlayMap] = useState<Record<string, TranslationOverlayEntry>>({})
  const setTranslationOverlay = useCallback<TranslationOverlaySetter>((messageId, entry) => {
    setTranslationOverlayMap((prev) => {
      if (entry == null) {
        if (!(messageId in prev)) return prev
        const next = { ...prev }
        delete next[messageId]
        return next
      }
      const existing = prev[messageId]
      if (
        existing &&
        existing.content === entry.content &&
        existing.targetLanguage === entry.targetLanguage &&
        existing.sourceLanguage === entry.sourceLanguage
      ) {
        return prev
      }
      return { ...prev, [messageId]: entry }
    })
  }, [])

  const finishRef = useRef<(executionId: string, event: ExecutionFinishEvent) => void>(undefined)
  const { overlay, disposeOverlay } = useExecutionOverlay(topic.id, activeExecutions, messages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const partsByMessageId = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const message of messages) {
      next[message.id] = (message.parts ?? []) as CherryMessagePart[]
    }
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (messageId in next && parts.length) next[messageId] = parts
    }
    for (const [messageId, entry] of Object.entries(translationOverlay)) {
      const existing = next[messageId]
      if (!existing) continue
      const baseParts = existing.filter((part) => part.type !== 'data-translation')
      next[messageId] = [
        ...baseParts,
        {
          type: 'data-translation',
          data: {
            content: entry.content,
            targetLanguage: entry.targetLanguage,
            ...(entry.sourceLanguage && { sourceLanguage: entry.sourceLanguage })
          }
        } as CherryMessagePart
      ]
    }
    return next
  }, [messages, overlay, translationOverlay])

  const respondToolApproval = useToolApprovalBridge(topic.id)
  const toolApprovalComposerOverrides = useToolApprovalComposerOverrides({
    partsByMessageId,
    onRespond: respondToolApproval
  })
  const composerContext = useMemo(
    () => ({
      overrides: toolApprovalComposerOverrides
    }),
    [toolApprovalComposerOverrides]
  )

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message, isError }: ExecutionFinishEvent) => {
      if (isError || !message.parts?.length) {
        void cache.rollbackBranch().then(() => disposeOverlay(message.id))
        return
      }
      void refresh().finally(() => disposeOverlay(message.id))
    },
    [cache, disposeOverlay, refresh]
  )
  finishRef.current = handleExecutionFinish
  const shouldRenderHomeComposer = isFreshTemporaryTopic && uiMessages.length === 0 && activeExecutions.length === 0

  // Chat write-side handlers (delete / edit / regenerate / resend / fork /
  // setActiveNode / clearTopic). Also exposes `capabilityBody` so the send
  // path below mirrors the same shape.
  const { actions: chatWriteActions, capabilityBody } = useChatWriteActions({
    topic,
    uiMessages: messages,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const handleSend = useCallback(
    async (
      text: string,
      options?: {
        files?: FileMetadata[]
        mentionedModels?: UniqueModelId[]
        knowledgeBaseIds?: string[]
        userMessageParts?: CherryMessagePart[]
      }
    ) => {
      if (isFreshTemporaryTopic && onPersistTemporaryTopic) {
        try {
          // Seed the new topic with the user's first message as a placeholder
          // name so the sidebar entry isn't blank pre-auto-name.
          await onPersistTemporaryTopic(text)
          onTemporaryTopicPersisted()
        } catch (err) {
          logger.warn('failed to persist temporary topic', err as Error)
          await cache.rollbackBranch()
          throw err
        }
      }
      addPending({
        text,
        parentId: activeNodeId ?? null,
        files: options?.files,
        parts: options?.userMessageParts,
        withAssistantPlaceholder: !options?.mentionedModels?.length
      })
      try {
        await sendMessage(
          { text },
          {
            body: {
              parentAnchorId: activeNodeId ?? undefined,
              files: options?.files,
              mentionedModels: options?.mentionedModels,
              userMessageParts: options?.userMessageParts,
              ...capabilityBody,
              ...(options?.knowledgeBaseIds?.length && { knowledgeBaseIds: options.knowledgeBaseIds })
            }
          }
        )
      } catch (err) {
        // IPC reject / Main persistence error: drop the phantom bubble
        // by forcing a revalidation against the server.
        await cache.rollbackBranch()
        throw err
      }
    },
    [
      isFreshTemporaryTopic,
      onPersistTemporaryTopic,
      onTemporaryTopicPersisted,
      activeNodeId,
      sendMessage,
      capabilityBody,
      cache,
      addPending
    ]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  return (
    <ChatWriteProvider value={chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <TranslationOverlaySetterProvider value={setTranslationOverlay}>
            <TranslationOverlayProvider value={translationOverlay}>
              {(() => {
                const main = (
                  <>
                    <HomeMessageList
                      key={topic.id}
                      topic={topic}
                      messages={messages}
                      partsByMessageId={partsByMessageId}
                      loadOlder={loadOlder}
                      hasOlder={hasOlder}
                      openCitationsPanel={onOpenCitationsPanel}
                      respondToolApproval={respondToolApproval}
                    />
                  </>
                )
                const composer = (
                  <ComposerContextProvider value={composerContext}>
                    <ComposerCore
                      fallback={
                        shouldRenderHomeComposer ? (
                          <ChatHomeComposer
                            topic={topic}
                            onSend={handleSend}
                            onTemporaryAssistantChange={onTemporaryAssistantChange}
                            onNewTopic={onNewTopic}
                          />
                        ) : (
                          <ChatComposer topic={topic} onSend={handleSend} onNewTopic={onNewTopic} />
                        )
                      }
                    />
                  </ComposerContextProvider>
                )
                const dockedFrame = (
                  <ComposerDockTransitionFrame
                    placement={shouldRenderHomeComposer ? 'home' : 'docked'}
                    main={main}
                    composer={composer}
                    mainVisible={!shouldRenderHomeComposer}
                  />
                )

                if (renderFrame) {
                  return renderFrame({ main: dockedFrame })
                }

                return (
                  <>
                    <div
                      className="flex flex-1 flex-col justify-between"
                      style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                      {dockedFrame}
                    </div>
                  </>
                )
              })()}
            </TranslationOverlayProvider>
          </TranslationOverlaySetterProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </ChatWriteProvider>
  )
}

export default ChatContent

const HomeMessageList: FC<{
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  loadOlder: () => void
  hasOlder: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  respondToolApproval: NonNullable<MessageListActions['respondToolApproval']>
}> = ({ topic, messages, partsByMessageId, loadOlder, hasOlder, openCitationsPanel, respondToolApproval }) => {
  const value = useHomeMessageListProviderValue({
    topic,
    messages,
    partsByMessageId,
    loadOlder,
    hasOlder,
    openCitationsPanel,
    respondToolApproval
  })
  return (
    <MessageListProvider value={value}>
      <MessageList />
    </MessageListProvider>
  )
}
