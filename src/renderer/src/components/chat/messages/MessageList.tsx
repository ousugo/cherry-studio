import { LoadingIcon } from '@renderer/components/Icons'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import SelectionContextMenu from '@renderer/components/SelectionContextMenu'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  captureScrollableAsBlob,
  captureScrollableAsDataURL,
  removeSpecialCharactersForFileName
} from '@renderer/utils'
import type { MultiModelMessageStyle } from '@shared/data/preference/preferenceTypes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import NarrowLayout from '../layout/NarrowLayout'
import MessageOutline from './frame/MessageOutline'
import { MessageListInitialLoading } from './layout/MessageListLoading'
import { MessagesContainer } from './layout/shared'
import MessageAnchorLine from './list/MessageAnchorLine'
import MessageGroup from './list/MessageGroup'
import MessageNavigation from './list/MessageNavigation'
import { MessageVirtualList, type MessageVirtualListHandle } from './list/MessageVirtualList'
import SelectionBox from './list/SelectionBox'
import {
  useMessageListActions,
  useMessageListData,
  useMessageListMeta,
  useMessageListSelection,
  useMessageRenderConfig
} from './MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem } from './types'

const MULTI_SELECT_BOTTOM_PADDING_PX = 96
const MESSAGE_OUTLINE_LAYOUTS: MultiModelMessageStyle[] = ['horizontal', 'vertical', 'fold', 'grid']

interface ActiveMessageOutline {
  messageId: string
  multiModelMessageStyle: MultiModelMessageStyle
}

function groupMessageListItems(messages: MessageListItem[]): Record<string, MessageListItem[]> {
  const grouped: Record<string, MessageListItem[]> = {}

  for (const message of messages) {
    const key =
      message.role === 'assistant' && message.parentId ? `assistant${message.parentId}` : message.role + message.id
    grouped[key] ??= []
    grouped[key].push(message)
  }

  return grouped
}

function getMessageElementLayout(element: HTMLElement): MultiModelMessageStyle {
  return MESSAGE_OUTLINE_LAYOUTS.find((layout) => element.classList.contains(layout)) ?? 'fold'
}

const MessageList = () => {
  const data = useMessageListData()
  const actions = useMessageListActions()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig() ?? defaultMessageRenderConfig
  const selection = useMessageListSelection()
  const { topic, messages, beforeList, hasOlder = false, messageNavigation } = data
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const isMultiSelectMode = selection?.isMultiSelectMode ?? false
  const selectedMessageIds = selection?.selectedMessageIds ?? []
  const [activeOutline, setActiveOutline] = useState<ActiveMessageOutline | null>(null)

  const messageListRef = useRef<MessageVirtualListHandle | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messageElements = useRef<Map<string, HTMLElement>>(new Map())

  const groupedMessages = useMemo(() => Object.entries(groupMessageListItems(messages)), [messages])
  const { bindRuntime, copyImage, saveImage } = actions

  const registerMessageElement = useCallback((id: string, element: HTMLElement | null) => {
    if (element) {
      messageElements.current.set(id, element)
    } else {
      messageElements.current.delete(id)
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    messageListRef.current?.scrollToBottom('instant')
  }, [])

  const scrollToMessageById = useCallback(
    (messageId: string) => {
      const target = messages.find((m) => m.id === messageId)
      if (!target) return
      const groupKey =
        target.role === 'assistant' && target.parentId ? 'assistant' + target.parentId : target.role + target.id
      messageListRef.current?.scrollToKey(groupKey, 'start')
    },
    [messages]
  )

  const updateActiveMessageOutline = useCallback(() => {
    if (!renderConfig.showMessageOutline || isMultiSelectMode) {
      setActiveOutline(null)
      return
    }

    const scrollElement = scrollContainerRef.current ?? messageListRef.current?.getScrollElement()
    if (!scrollElement) {
      setActiveOutline(null)
      return
    }

    const containerRect = scrollElement.getBoundingClientRect()
    const viewportCenter = containerRect.top + containerRect.height / 2
    let bestMatch: { messageId: string; multiModelMessageStyle: MultiModelMessageStyle; distance: number } | null = null

    for (const message of messages) {
      if (message.role !== 'assistant' || message.type === 'clear') continue

      const element = document.getElementById(`message-${message.id}`)
      if (!element || window.getComputedStyle(element).display === 'none') continue

      const rect = element.getBoundingClientRect()
      const visibleHeight = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
      if (visibleHeight <= 0) continue

      const distance =
        rect.top <= viewportCenter && rect.bottom >= viewportCenter
          ? 0
          : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter))

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          messageId: message.id,
          multiModelMessageStyle: getMessageElementLayout(element),
          distance
        }
      }
    }

    setActiveOutline((current) => {
      if (
        current?.messageId === bestMatch?.messageId &&
        current?.multiModelMessageStyle === bestMatch?.multiModelMessageStyle
      ) {
        return current
      }
      return bestMatch
        ? {
            messageId: bestMatch.messageId,
            multiModelMessageStyle: bestMatch.multiModelMessageStyle
          }
        : null
    })
  }, [isMultiSelectMode, messages, renderConfig.showMessageOutline])

  const loadMoreMessages = useCallback(() => {
    if (!hasOlder || isLoadingMore || !actions.loadOlder) return
    setIsLoadingMore(true)
    setTimeoutTimer(
      'message-list-load-older',
      () => {
        actions.loadOlder?.()
        setTimeoutTimer('message-list-load-older-spinner', () => setIsLoadingMore(false), data.loadingResetDelayMs)
      },
      data.loadOlderDelayMs
    )
  }, [actions, data.loadOlderDelayMs, data.loadingResetDelayMs, hasOlder, isLoadingMore, setTimeoutTimer])

  useEffect(() => {
    scrollContainerRef.current = (messageListRef.current?.getScrollElement() as HTMLDivElement | null) ?? null
  }, [groupedMessages])

  useEffect(() => {
    const scrollElement = messageListRef.current?.getScrollElement()
    scrollContainerRef.current = (scrollElement as HTMLDivElement | null) ?? null
    updateActiveMessageOutline()

    if (!scrollElement) return

    scrollElement.addEventListener('scroll', updateActiveMessageOutline, { passive: true })
    window.addEventListener('resize', updateActiveMessageOutline)

    return () => {
      scrollElement.removeEventListener('scroll', updateActiveMessageOutline)
      window.removeEventListener('resize', updateActiveMessageOutline)
    }
  }, [groupedMessages, updateActiveMessageOutline])

  useEffect(() => {
    return bindRuntime?.({
      scrollToBottom,
      copyTopicImage: async () => {
        await captureScrollableAsBlob(scrollContainerRef, async (blob) => {
          if (blob) {
            await copyImage?.(blob)
          }
        })
      },
      exportTopicImage: async () => {
        if (!meta.imageExportFileName || !saveImage) return
        const imageData = await captureScrollableAsDataURL(scrollContainerRef)
        if (imageData) {
          await saveImage(removeSpecialCharactersForFileName(meta.imageExportFileName), imageData)
        }
      }
    })
  }, [bindRuntime, copyImage, meta.imageExportFileName, saveImage, scrollToBottom])

  if (data.isInitialLoading) {
    return <MessageListInitialLoading />
  }

  const activeOutlineMessage = activeOutline
    ? messages.find((message) => message.id === activeOutline.messageId)
    : undefined

  return (
    <MessagesContainer id="messages" className="messages-container" key={data.listKey}>
      {beforeList && (
        <NarrowLayout narrowMode={renderConfig.narrowMode} withSidePadding className="shrink-0">
          {beforeList}
        </NarrowLayout>
      )}
      <SelectionContextMenu>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <MessageVirtualList
            handleRef={messageListRef}
            items={groupedMessages}
            getItemKey={([key]) => key}
            estimateSize={data.estimateSize}
            overscan={data.overscan}
            bottomPadding={isMultiSelectMode ? MULTI_SELECT_BOTTOM_PADDING_PX : undefined}
            hasMoreTop={hasOlder}
            onReachTop={loadMoreMessages}
            renderItem={([key, groupMessages]) => (
              <NarrowLayout narrowMode={renderConfig.narrowMode} withSidePadding>
                <MessageGroup
                  key={key}
                  messages={groupMessages}
                  topic={topic}
                  registerMessageElement={registerMessageElement}
                />
              </NarrowLayout>
            )}
            style={{ flex: 1, minHeight: 0 }}
          />
          {isLoadingMore && (
            <div
              className="pointer-events-none flex w-full justify-center py-2.5"
              style={{ background: 'var(--color-background)' }}>
              <LoadingIcon color="var(--color-foreground-secondary)" />
            </div>
          )}
        </div>
      </SelectionContextMenu>
      {messageNavigation === 'anchor' && (
        <MessageAnchorLine
          messages={messages}
          scrollToMessageId={scrollToMessageById}
          scrollToBottom={scrollToBottom}
        />
      )}
      {activeOutline && activeOutlineMessage && (
        <MessageOutline message={activeOutlineMessage} multiModelMessageStyle={activeOutline.multiModelMessageStyle} />
      )}
      {messageNavigation === 'buttons' && (
        <MessageNavigation containerId="messages" messages={messages} scrollToMessageId={scrollToMessageById} />
      )}
      {meta.selectionLayer && (
        <SelectionBox
          isMultiSelectMode={isMultiSelectMode}
          scrollContainerRef={scrollContainerRef as React.RefObject<HTMLDivElement>}
          messageElements={messageElements.current}
          handleSelectMessage={(messageId, selected) => actions.selectMessage?.(messageId, selected)}
        />
      )}
      <MultiSelectActionPopup
        selectedMessageIds={selectedMessageIds}
        isMultiSelectMode={isMultiSelectMode}
        onSave={
          actions.saveSelectedMessages ? () => void actions.saveSelectedMessages?.(selectedMessageIds) : undefined
        }
        onCopy={
          actions.copySelectedMessages ? () => void actions.copySelectedMessages?.(selectedMessageIds) : undefined
        }
        onDelete={
          actions.deleteSelectedMessages ? () => void actions.deleteSelectedMessages?.(selectedMessageIds) : undefined
        }
        onClose={() => actions.toggleMultiSelectMode?.(false)}
      />
    </MessagesContainer>
  )
}

export default MessageList
