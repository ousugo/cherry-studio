import { fireEvent, render, screen } from '@testing-library/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode, Ref } from 'react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatAppShell } from '../ChatAppShell'
import {
  RESOURCE_LIST_PANE_DEFAULT_WIDTH,
  RESOURCE_LIST_PANE_MAX_WIDTH,
  RESOURCE_LIST_PANE_MIN_WIDTH
} from '../useResourceListPaneResize'

const persistCacheMock = vi.hoisted(() => {
  const state = { width: 275 }

  return {
    state,
    setWidth: vi.fn((width: number) => {
      state.width = width
    })
  }
})

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: vi.fn(() => [persistCacheMock.state.width, persistCacheMock.setWidth])
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  layout?: unknown
  ref?: Ref<HTMLDivElement>
  transition?: unknown
}

vi.mock('motion/react', () => {
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: ({ ref, children, ...props }: MotionDivProps) => {
        const domProps = { ...props }
        delete domProps.animate
        delete domProps.exit
        delete domProps.initial
        delete domProps.layout
        delete domProps.transition

        return (
          <div ref={ref} {...domProps}>
            {children}
          </div>
        )
      }
    }
  }
})

describe('ChatAppShell', () => {
  afterEach(() => {
    persistCacheMock.state.width = RESOURCE_LIST_PANE_DEFAULT_WIDTH
    persistCacheMock.setWidth.mockClear()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.documentElement.style.removeProperty('--assistants-width')
    vi.restoreAllMocks()
  })

  it('keeps side panel inside chat-main with the navbar layer', () => {
    const { container } = render(
      <ChatAppShell
        centerId="chat-main"
        topBar={<div data-testid="navbar" />}
        sidePanel={<div data-testid="settings-panel" />}
        main={<div data-testid="main" />}
      />
    )

    const chatMain = container.querySelector('#chat-main')

    expect(chatMain).toContainElement(screen.getByTestId('navbar'))
    expect(chatMain).toContainElement(screen.getByTestId('settings-panel'))
    expect(chatMain).toContainElement(screen.getByTestId('main'))
    expect(chatMain).toHaveClass('relative')
  })

  it('keeps the pane mounted when keyed center content changes', () => {
    const paneMounts: string[] = []

    function Pane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        paneMounts.push('mounted')
      }, [])

      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          pane count {count}
        </button>
      )
    }

    const { rerender } = render(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-1">topic 1 content</div>}
        topBar={<div>topic 1 nav</div>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    rerender(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-2">topic 2 content</div>}
        topBar={<div>topic 2 nav</div>}
      />
    )

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()
    expect(screen.queryByText('topic 1 content')).not.toBeInTheDocument()
    expect(screen.getByText('topic 2 content')).toBeInTheDocument()
    expect(paneMounts).toEqual(['mounted'])
  })

  it('drives the left resource pane width from persist cache', () => {
    persistCacheMock.state.width = 180

    render(<ChatAppShell pane={<aside>topics</aside>} paneOpen main={<div />} />)

    expect(document.documentElement.style.getPropertyValue('--assistants-width')).toBe(
      `${RESOURCE_LIST_PANE_MIN_WIDTH}px`
    )
  })

  it('clamps drag width and cleans document resize styles', () => {
    const { container } = render(<ChatAppShell pane={<aside>topics</aside>} paneOpen main={<div />} />)
    const pane = container.querySelector('[data-resource-list-pane]')
    const handle = container.querySelector('[data-resource-list-pane-resize-handle]')

    if (!pane || !handle) {
      throw new Error('Expected resource list pane and resize handle')
    }

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 275, 500))

    fireEvent.mouseDown(handle, { clientX: 375 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
    expect(pane).toHaveAttribute('data-resizing', 'true')

    fireEvent.mouseMove(document, { clientX: 350 })
    fireEvent.mouseMove(document, { clientX: 50 })
    fireEvent.mouseMove(document, { clientX: 600 })

    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(1, 250)
    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(2, RESOURCE_LIST_PANE_MIN_WIDTH)
    expect(persistCacheMock.setWidth).toHaveBeenNthCalledWith(3, RESOURCE_LIST_PANE_MAX_WIDTH)

    fireEvent.mouseUp(document)

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
    expect(pane).not.toHaveAttribute('data-resizing')
  })
})
