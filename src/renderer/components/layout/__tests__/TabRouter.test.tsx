import '@testing-library/jest-dom/vitest'

import { createMemoryHistory } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}))

vi.mock('@cherrystudio/ui', () => ({
  TooltipPortalContainerProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/routeTree.gen', () => ({
  routeTree: {}
}))

vi.mock('@tanstack/react-router', async () => {
  const { useSelectorPortalContainer } = await import(
    '@renderer/components/Selector/shell/SelectorPortalContainerContext'
  )

  return {
    createMemoryHistory: vi.fn((options: { initialEntries: string[] }) => options),
    createRouter: vi.fn(({ history }: { history: { initialEntries: string[] } }) => ({
      navigate: routerMocks.navigate,
      subscribe: routerMocks.subscribe,
      state: {
        location: {
          href: history.initialEntries[0]
        }
      }
    })),
    RouterProvider: () => {
      const container = useSelectorPortalContainer()

      return (
        <div
          data-testid="router-provider"
          data-has-selector-container={String(container instanceof HTMLElement)}
          data-selector-container-is-body={String(container === document.body)}
        />
      )
    }
  }
})

import { TabRouter } from '../TabRouter'

describe('TabRouter', () => {
  beforeEach(() => {
    routerMocks.navigate.mockClear()
    routerMocks.subscribe.mockClear()
    vi.mocked(createMemoryHistory).mockClear()
  })

  it('provides the tab root as the selector portal container', async () => {
    render(
      <TabRouter
        tab={{
          id: 'translate-tab',
          type: 'route',
          url: '/app/translate',
          title: 'Translate',
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-has-selector-container', 'true')
    )
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-selector-container-is-body', 'false')
  })

  it('uses the tab entry URL even when instance metadata points to another key', () => {
    render(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=entry-topic',
          title: 'Chat',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'current-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledWith({ initialEntries: ['/app/chat?topicId=entry-topic'] })
    expect(routerMocks.navigate).not.toHaveBeenCalled()
  })

  it('uses the tab entry URL when metadata belongs to a different app route', () => {
    render(
      <TabRouter
        tab={{
          id: 'settings-tab',
          type: 'route',
          url: '/settings/provider',
          title: 'Settings',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'old-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledWith({ initialEntries: ['/settings/provider'] })
  })

  it('navigates when the tab entry URL changes externally', () => {
    const { rerender } = render(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=entry-topic',
          title: 'Chat',
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )
    routerMocks.navigate.mockClear()

    rerender(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=current-topic',
          title: 'Chat',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'current-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledTimes(1)
    expect(routerMocks.navigate).toHaveBeenCalledWith({ to: '/app/chat?topicId=current-topic' })
  })
})
