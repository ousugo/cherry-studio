import { act, render, screen } from '@testing-library/react'
import type { ReactNode, Ref } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageVirtualListHandle } from '../list/MessageVirtualList'
import MessageList from '../MessageList'
import { MessageListProvider } from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../types'

const scrollToBottom = vi.fn()

vi.mock('@renderer/components/chat/layout/ChatLayoutModeContext', () => ({
  useChatLayoutMode: () => ({ setForceWideLayout: vi.fn() })
}))

vi.mock('@renderer/components/Icons', () => ({
  LoadingIcon: () => <div data-testid="loading-icon" />
}))

vi.mock('@renderer/components/Popups/MultiSelectionPopup', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: (_key: string, callback: () => void) => callback()
  })
}))

vi.mock('@renderer/utils', () => ({
  captureScrollableAsBlob: vi.fn(),
  captureScrollableAsDataURL: vi.fn(),
  removeSpecialCharactersForFileName: (value: string) => value
}))

vi.mock('../layout/NarrowLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../frame/MessageOutline', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../layout/MessageListLoading', () => ({
  MessageListInitialLoading: () => <div data-testid="message-list-loading" />
}))

vi.mock('../list/MessageAnchorLine', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/MessageGroup', () => ({
  __esModule: true,
  default: ({ messages }: { messages: MessageListItem[] }) => (
    <div data-testid="message-group">{messages.map((message) => message.id).join(',')}</div>
  )
}))

vi.mock('../list/MessageNavigation', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/SelectionBox', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('../list/MessageVirtualList', async () => {
  const React = await import('react')
  return {
    MessageVirtualList: ({ forceScrollToBottomKey, handleRef, items, renderItem }: any) => {
      React.useImperativeHandle(
        handleRef as Ref<MessageVirtualListHandle>,
        () => ({
          scrollToBottom,
          scrollToKey: vi.fn(),
          isAtBottom: () => false,
          getScrollElement: () => document.createElement('div')
        }),
        []
      )

      return (
        <div data-force-scroll-key={forceScrollToBottomKey ?? ''} data-testid="virtual-list">
          {items.map((item: unknown, index: number) => (
            <div key={index}>{renderItem(item, index)}</div>
          ))}
        </div>
      )
    }
  }
})

const createMessage = (id: string, role: MessageListItem['role']): MessageListItem => ({
  id,
  role,
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00Z',
  status: 'success'
})

const createValue = (messages: MessageListItem[]): MessageListProviderValue => ({
  state: {
    topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
    messages,
    partsByMessageId: {},
    messageNavigation: 'none',
    estimateSize: 400,
    overscan: 0,
    loadOlderDelayMs: 0,
    loadingResetDelayMs: 0,
    renderConfig: defaultMessageRenderConfig
  },
  actions: {},
  meta: { selectionLayer: false }
})

const renderMessageList = (messages: MessageListItem[]) =>
  render(
    <MessageListProvider value={createValue(messages)}>
      <MessageList />
    </MessageListProvider>
  )

describe('MessageList', () => {
  it('signals the virtual list to scroll after a user message is appended before an assistant placeholder', () => {
    const view = renderMessageList([createMessage('assistant-1', 'assistant')])
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', '')

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue([
            createMessage('assistant-1', 'assistant'),
            createMessage('user-1', 'user'),
            createMessage('assistant-placeholder', 'assistant')
          ])}>
          <MessageList />
        </MessageListProvider>
      )
    })

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'user-1')
  })

  it('does not signal forced scroll when an assistant message is appended', () => {
    const view = renderMessageList([createMessage('user-1', 'user')])
    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'user-1')

    act(() => {
      view.rerender(
        <MessageListProvider
          value={createValue([createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')])}>
          <MessageList />
        </MessageListProvider>
      )
    })

    expect(screen.getByTestId('virtual-list')).toHaveAttribute('data-force-scroll-key', 'user-1')
  })
})
