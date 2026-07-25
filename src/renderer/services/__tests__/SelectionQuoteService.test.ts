import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { describe, expect, it, vi } from 'vitest'

import { findSelectionQuoteTargetTab, routeSelectionQuoteToChat, selectionQuoteService } from '../SelectionQuoteService'

function tab(id: string, url: string, lastAccessTime: number): Tab {
  return { id, url, lastAccessTime, type: 'route', isDormant: false, title: id }
}

describe('SelectionQuoteService', () => {
  it('keeps the active usable chat tab', () => {
    const activeChat = tab('active-chat', '/app/chat?topicId=active', 1)
    const newerChat = tab('newer-chat', '/app/chat?topicId=newer', 2)

    expect(findSelectionQuoteTargetTab([activeChat, newerChat], activeChat)).toBe(activeChat)
  })

  it('selects the most recently used chat tab when another page is active', () => {
    const settings = tab('settings', '/settings/general', 3)
    const olderChat = tab('older-chat', '/app/chat?topicId=older', 1)
    const newerChat = tab('newer-chat', '/app/chat?topicId=newer', 2)

    expect(findSelectionQuoteTargetTab([settings, olderChat, newerChat], settings)).toBe(newerChat)
  })

  it('requires a new chat when only non-composer pages exist', () => {
    const settings = tab('settings', '/settings/general', 2)
    const messageView = tab('message-view', '/app/chat?topicId=topic&view=message', 1)

    expect(findSelectionQuoteTargetTab([settings, messageView], settings)).toBeUndefined()
  })

  it('delivers a stored quote exactly once', () => {
    selectionQuoteService.store('request-1', 'Selected text')

    expect(selectionQuoteService.take('request-1')).toBe('Selected text')
    expect(selectionQuoteService.take('request-1')).toBeUndefined()
  })

  it('routes to an existing chat without creating another tab', () => {
    const settings = tab('settings', '/settings/general', 3)
    const chat = tab('chat', '/app/chat?topicId=topic-1', 2)
    const openTab = vi.fn(() => 'new-tab')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      requestId: 'request-1',
      setActiveTab,
      tabs: [settings, chat],
      updateTab
    })

    expect(openTab).not.toHaveBeenCalled()
    expect(updateTab).toHaveBeenCalledWith('chat', {
      url: '/app/chat?topicId=topic-1&quoteRequestId=request-1'
    })
    expect(setActiveTab).toHaveBeenCalledWith('chat')
  })

  it('opens a new chat only when no usable chat tab exists', () => {
    const settings = tab('settings', '/settings/general', 3)
    const openTab = vi.fn(() => 'new-tab')
    const setActiveTab = vi.fn()
    const updateTab = vi.fn()

    routeSelectionQuoteToChat({
      activeTab: settings,
      openTab,
      requestId: 'request-1',
      setActiveTab,
      tabs: [settings],
      updateTab
    })

    expect(openTab).toHaveBeenCalledWith('/app/chat?quoteRequestId=request-1', { forceNew: true })
    expect(updateTab).not.toHaveBeenCalled()
    expect(setActiveTab).not.toHaveBeenCalled()
  })
})
