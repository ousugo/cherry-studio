// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeTab = {
  id: string
  type: 'route' | 'miniapp'
  url: string
  title: string
  metadata?: Record<string, unknown>
}

const mocks = vi.hoisted(() => ({
  emitResourceListReveal: vi.fn(),
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  setSidebarWidth: vi.fn(),
  tabs: [] as FakeTab[],
  lastUsedTopicId: null as string | null,
  lastUsedSessionId: null as string | null,
  visibleSidebarIcons: ['assistants'] as string[]
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: (key: string) => {
    if (key === 'ui.chat.last_used_topic_id') return [mocks.lastUsedTopicId, vi.fn()]
    if (key === 'ui.agent.last_used_session_id') return [mocks.lastUsedSessionId, vi.fn()]
    return [0, mocks.setSidebarWidth]
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'app.user.name') return ['JD']
    if (key === 'ui.sidebar.icons.visible') return [mocks.visibleSidebarIcons]
    return [undefined]
  }
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'logo.png'
}))

vi.mock('@renderer/hooks/useAvatar', () => ({
  default: () => undefined
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ defaultPaintingProvider: undefined })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabel: (icon: string) =>
    ({
      agents: 'Agent',
      assistants: 'Chat',
      translate: 'Translate'
    })[icon]
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: () => 'Chat'
}))

vi.mock('@renderer/components/chat/resources/resourceListRevealEvents', () => ({
  emitResourceListReveal: mocks.emitResourceListReveal
}))

vi.mock('../../../hooks/useTabs', () => ({
  useTabs: () => ({
    activeTab: {
      id: 'chat',
      type: 'route',
      url: '/app/chat',
      title: 'Chat'
    },
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab
  })
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => ({
    tabs: mocks.tabs,
    openTab: mocks.openTab,
    setActiveTab: mocks.setActiveTab
  })
}))

vi.mock('../../Popups/UserPopup', () => ({
  default: {
    show: vi.fn()
  }
}))

vi.mock('../../Icons/SVGIcon', () => ({
  OpenClawSidebarIcon: () => null
}))

vi.mock('../../Sidebar', () => ({
  Sidebar: ({
    isFloating,
    isFloatingClosing,
    onDismiss,
    onHoverChange,
    onItemClick,
    items
  }: {
    isFloating?: boolean
    isFloatingClosing?: boolean
    items?: Array<{ id: string; label: string }>
    onDismiss?: () => void
    onHoverChange?: (hovering: boolean) => void
    onItemClick?: (id: string) => void
  }) =>
    isFloating ? (
      <div
        className={isFloatingClosing ? 'slide-out-to-left-2 animate-out' : 'slide-in-from-left-2 animate-in'}
        data-testid="floating-sidebar">
        <button type="button" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    ) : (
      <>
        <button type="button" onClick={() => onHoverChange?.(true)}>
          reveal
        </button>
        <div data-testid="sidebar-items">
          {items?.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`sidebar-item-${item.id}`}
              onClick={() => onItemClick?.(item.id)}>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </>
    )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'common.search') return 'Search'
      return options?.defaultValue ?? key
    }
  })
}))

import { resolveSidebarAppTabEntryUrl } from '@renderer/config/sidebar'

import Sidebar from '../Sidebar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.visibleSidebarIcons = ['assistants']
  mocks.tabs = []
  mocks.lastUsedTopicId = null
  mocks.lastUsedSessionId = null
  vi.useRealTimers()
})

describe('app Sidebar', () => {
  it('derives conversation detach URLs from instance metadata', () => {
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/chat?topicId=entry-topic',
        metadata: { instanceAppId: 'assistants', instanceKey: 'current-topic' }
      })
    ).toBe('/app/chat?topicId=current-topic')
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/agents?sessionId=entry-session',
        metadata: { instanceAppId: 'agents', instanceKey: 'current-session' }
      })
    ).toBe('/app/agents?sessionId=current-session')
  })

  it('keeps a message-only detach URL when there is no normal instance key', () => {
    expect(
      resolveSidebarAppTabEntryUrl({
        url: '/app/chat?topicId=t-1&view=message',
        metadata: { instanceAppId: 'assistants', instanceKey: 'stale-topic' }
      })
    ).toBe('/app/chat?topicId=t-1&view=message')
  })

  it('keeps the floating sidebar mounted for its closing animation before unmounting', () => {
    vi.useFakeTimers()
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'reveal' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-in', 'slide-in-from-left-2')

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.getByTestId('floating-sidebar')).toHaveClass('animate-out', 'slide-out-to-left-2')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByTestId('floating-sidebar')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
  })

  it('renders sidebar menu items in visible preference order', () => {
    mocks.visibleSidebarIcons = ['translate', 'assistants', 'agents']

    render(<Sidebar />)

    const labels = Array.from(screen.getByTestId('sidebar-items').querySelectorAll('span')).map(
      (element) => element.textContent
    )
    expect(labels).toEqual(['Translate', 'Chat', 'Agent'])
  })

  it('keyed multi (agents): focuses the existing tab carrying the default session key', () => {
    mocks.visibleSidebarIcons = ['agents']
    mocks.lastUsedSessionId = 's-1'
    mocks.tabs = [
      { id: 'agents-1', type: 'route', url: '/app/agents?sessionId=s-1', title: 'Session 1' },
      { id: 'agents-2', type: 'route', url: '/app/agents?sessionId=s-2', title: 'Session 2' }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('agents-1')
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'agents', tabId: 'agents-1' })
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('keyed multi (agents): opens a new session-keyed tab when none exists', () => {
    mocks.visibleSidebarIcons = ['agents']
    mocks.lastUsedSessionId = 's-1'
    mocks.tabs = [{ id: 'chat-1', type: 'route', url: '/app/chat?assistantId=A', title: 'Chat' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.openTab.mock.calls[0]
    expect(url).toBe('/app/agents')
    expect(options?.forceNew).toBe(true)
    expect(options?.metadata).toEqual({ instanceAppId: 'agents', instanceKey: 's-1' })
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('instanced (agents): with no last_used session and no tab, opens the bare app route', () => {
    mocks.visibleSidebarIcons = ['agents']
    mocks.lastUsedSessionId = null
    mocks.tabs = []

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-agents'))

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.openTab.mock.calls[0]
    expect(url).toBe('/app/agents')
    expect(options?.forceNew).toBeUndefined()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('instanced (assistants): with no last_used topic, focuses any existing chat tab instead of spawning', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = null
    mocks.tabs = [{ id: 'chat-1', type: 'route', url: '/app/chat?topicId=t-1', title: 'Chat' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('chat-1')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('keyed multi (assistants): focuses the existing tab carrying the default topic key', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-1'
    mocks.tabs = [
      { id: 'chat-a', type: 'route', url: '/app/chat?topicId=t-1', title: 'Chat A' },
      { id: 'chat-b', type: 'route', url: '/app/chat?topicId=t-2', title: 'Chat B' }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('chat-a')
    expect(mocks.emitResourceListReveal).toHaveBeenCalledWith({ source: 'assistants', tabId: 'chat-a' })
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('keyed multi (assistants): opens a new topic-keyed tab when no existing match', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-1'
    mocks.tabs = [{ id: 'files-1', type: 'route', url: '/app/files', title: 'Files' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.openTab.mock.calls[0]
    expect(url).toBe('/app/chat')
    expect(options?.forceNew).toBe(true)
    expect(options?.metadata).toEqual({ instanceAppId: 'assistants', instanceKey: 't-1' })
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('keyed multi (assistants): opens forceNew when a stale URL belongs to a different current topic', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-1'
    mocks.tabs = [
      {
        id: 'chat-a',
        type: 'route',
        url: '/app/chat?topicId=t-1',
        title: 'Chat A',
        metadata: { instanceAppId: 'assistants', instanceKey: 't-2' }
      }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Chat',
      metadata: { instanceAppId: 'assistants', instanceKey: 't-1' }
    })
  })

  it('keyed multi (assistants): does not fallback to stale URL when metadata marks no current instance', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-1'
    mocks.tabs = [
      {
        id: 'chat-temp',
        type: 'route',
        url: '/app/chat?topicId=t-1',
        title: 'Draft',
        metadata: { instanceAppId: 'assistants' }
      }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Chat',
      metadata: { instanceAppId: 'assistants', instanceKey: 't-1' }
    })
  })

  it('keyed multi (assistants): does not reuse a message-only tab as the normal topic tab', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-1'
    mocks.tabs = [
      {
        id: 'chat-message',
        type: 'route',
        url: '/app/chat?topicId=t-1&view=message',
        title: 'Message',
        metadata: { instanceAppId: 'assistants', instanceKey: 't-1' }
      }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.openTab).toHaveBeenCalledWith('/app/chat', {
      forceNew: true,
      title: 'Chat',
      metadata: { instanceAppId: 'assistants', instanceKey: 't-1' }
    })
  })

  it('keyed multi (assistants): with last_used=t-2 and tabs on t-1 and t-2, focuses t-2', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-2'
    mocks.tabs = [
      { id: 'chat-a', type: 'route', url: '/app/chat?topicId=t-1', title: 'Chat A' },
      { id: 'chat-b', type: 'route', url: '/app/chat?topicId=t-2', title: 'Chat B' }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('chat-b')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('keyed multi (assistants): uses tab metadata when the entry URL is stale', () => {
    mocks.visibleSidebarIcons = ['assistants']
    mocks.lastUsedTopicId = 't-2'
    mocks.tabs = [
      {
        id: 'chat-a',
        type: 'route',
        url: '/app/chat?topicId=t-1',
        title: 'Chat A',
        metadata: { instanceAppId: 'assistants', instanceKey: 't-2' }
      }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-assistants'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('chat-a')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('single policy: switches to the existing tab when one matches the routePrefix', () => {
    mocks.visibleSidebarIcons = ['translate']
    mocks.tabs = [{ id: 'translate-1', type: 'route', url: '/app/translate', title: 'Translate' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-translate'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('translate-1')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('single policy: opens a new tab without forceNew when none exists', () => {
    mocks.visibleSidebarIcons = ['files']
    mocks.tabs = []

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-files'))

    expect(mocks.openTab).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.openTab.mock.calls[0]
    expect(url).toBe('/app/files')
    expect(options?.forceNew).toBeUndefined()
    expect(mocks.setActiveTab).not.toHaveBeenCalled()
  })

  it('single policy: prefix match identifies an existing sub-route tab', () => {
    mocks.visibleSidebarIcons = ['files']
    mocks.tabs = [{ id: 'files-deep', type: 'route', url: '/app/files/subfolder/x', title: 'Files' }]

    render(<Sidebar />)
    fireEvent.click(screen.getByTestId('sidebar-item-files'))

    expect(mocks.setActiveTab).toHaveBeenCalledWith('files-deep')
    expect(mocks.openTab).not.toHaveBeenCalled()
  })
})
