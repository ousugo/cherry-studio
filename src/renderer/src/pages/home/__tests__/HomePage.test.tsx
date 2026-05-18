import type { Topic } from '@renderer/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const initialTopic: Topic = {
  id: 'topic-initial',
  assistantId: 'assistant-1',
  name: 'Initial topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const historyTopic: Topic = {
  id: 'topic-history',
  assistantId: 'assistant-1',
  name: 'History topic',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  messages: [],
  pinned: false,
  isNameManuallyEdited: false
}

const homeMocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  discardTemporaryConversation: vi.fn(),
  eventHandlers: new Map<string, (payload?: unknown) => void>(),
  historyTopic: undefined as Topic | undefined,
  locationState: undefined as { topic: Topic } | undefined,
  persistTemporaryConversation: vi.fn(),
  preferenceValues: new Map<string, unknown>(),
  refreshTopics: vi.fn(),
  setShowSidebar: vi.fn(),
  startTemporaryConversation: vi.fn(),
  temporaryConversation: null as any
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: homeMocks.cacheGet,
    set: homeMocks.cacheSet
  }
}))

vi.mock('@data/hooks/usePreference', async () => {
  const React = await import('react')

  return {
    usePreference: (key: string) => {
      const [value, setValue] = React.useState(() => homeMocks.preferenceValues.get(key))
      const setPreference = vi.fn(async (nextValue: unknown) => {
        homeMocks.preferenceValues.set(key, nextValue)
        if (key === 'topic.tab.show') {
          homeMocks.setShowSidebar(nextValue)
        }
        setValue(nextValue)
      })

      return [value, setPreference]
    }
  }
})

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isLeftNavbar: false })
}))

vi.mock('@renderer/hooks/useShortcuts', () => ({
  useShortcut: vi.fn()
}))

vi.mock('@renderer/hooks/useTemporaryConversation', () => ({
  useTemporaryConversation: () => ({
    conversation: homeMocks.temporaryConversation,
    discard: homeMocks.discardTemporaryConversation,
    persist: homeMocks.persistTemporaryConversation,
    start: homeMocks.startTemporaryConversation
  })
}))

vi.mock('@renderer/hooks/useTopic', async () => {
  const React = await import('react')

  return {
    useTopicMutations: () => ({
      refreshTopics: homeMocks.refreshTopics
    }),
    useActiveTopic: (topic?: Topic) => {
      const [activeTopic, setActiveTopic] = React.useState<Topic | undefined>(topic)
      return { activeTopic, setActiveTopic }
    }
  }
})

vi.mock('@renderer/pages/history/HistoryRecordsPage', () => ({
  default: ({ onClose, onRecordSelect, open }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onRecordSelect?.(homeMocks.historyTopic)
          onClose?.()
        }}>
        Select history topic
      </button>
    ) : null
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    ADD_NEW_TOPIC: 'ADD_NEW_TOPIC',
    SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
    SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR'
  },
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn((eventName: string, handler: (payload?: unknown) => void) => {
      homeMocks.eventHandlers.set(eventName, handler)
      return () => homeMocks.eventHandlers.delete(eventName)
    })
  }
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: {
    setNavigate: vi.fn()
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    state: homeMocks.locationState
  }),
  useNavigate: () => vi.fn()
}))

vi.mock('../Chat', () => ({
  default: ({ activeTopic, pane, paneOpen }: { activeTopic: Topic; pane?: ReactNode; paneOpen?: boolean }) => (
    <section>
      <output data-testid="active-topic">{activeTopic.id}</output>
      <output data-testid="pane-open">{String(paneOpen)}</output>
      {pane}
    </section>
  )
}))

vi.mock('../Navbar', () => ({
  default: () => <nav />
}))

vi.mock('../Tabs', () => ({
  default: ({ onOpenHistory, revealRequest }: any) => (
    <div data-reveal-request={JSON.stringify(revealRequest ?? null)} data-testid="home-tabs">
      <button type="button" onClick={() => onOpenHistory?.()}>
        Open history
      </button>
    </div>
  )
}))

import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'

import HomePage from '../HomePage'

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    homeMocks.eventHandlers.clear()
    homeMocks.historyTopic = historyTopic
    homeMocks.locationState = { topic: initialTopic }
    homeMocks.persistTemporaryConversation.mockResolvedValue(null)
    homeMocks.startTemporaryConversation.mockResolvedValue({
      id: 'temp-topic',
      topicId: 'temp-topic',
      type: 'assistant'
    })
    homeMocks.temporaryConversation = null
    homeMocks.preferenceValues.clear()
    homeMocks.preferenceValues.set('topic.tab.show', false)
    homeMocks.preferenceValues.set('topic.position', 'left')

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        window: {
          resetMinimumSize: vi.fn().mockResolvedValue(undefined),
          setMinimumSize: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
  })

  it('opens the topic sidebar and forwards a reveal request after selecting a history topic', async () => {
    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-initial')
    expect(screen.getByTestId('pane-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Open history' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select history topic' }))

    await waitFor(() => expect(screen.getByTestId('active-topic')).toHaveTextContent('topic-history'))

    expect(homeMocks.setShowSidebar).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('pane-open')).toHaveTextContent('true')
    expect(JSON.parse(screen.getByTestId('home-tabs').getAttribute('data-reveal-request') ?? 'null')).toEqual({
      clearFilters: true,
      clearQuery: true,
      itemId: 'topic-history',
      requestId: 1
    })
  })

  it('does not lease another temporary topic while the active temporary topic is still empty', async () => {
    homeMocks.cacheGet.mockReturnValue(true)
    homeMocks.locationState = undefined
    homeMocks.temporaryConversation = {
      assistantId: 'assistant-1',
      id: 'temp-topic',
      topic: initialTopic,
      topicId: 'temp-topic',
      type: 'assistant'
    }

    render(<HomePage />)

    expect(screen.getByTestId('active-topic')).toHaveTextContent('temp-topic')

    homeMocks.eventHandlers.get(EVENT_NAMES.ADD_NEW_TOPIC)?.()

    expect(homeMocks.startTemporaryConversation).not.toHaveBeenCalled()
    expect(EventEmitter.emit).toHaveBeenCalledWith(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })
})
