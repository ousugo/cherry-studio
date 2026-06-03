import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageVirtualList } from '../MessageVirtualList'

const runtimeMockState = vi.hoisted(() => ({
  shift: false
}))

vi.mock('@cherrystudio/ui', () => {
  return {
    Scrollbar: ({ ref, children, ...props }: any) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    )
  }
})

vi.mock('virtua', () => {
  return {
    Virtualizer: ({ ref, children, data, shift, startMargin }: any) => (
      <div ref={ref} data-shift={String(shift)} data-start-margin={startMargin} data-testid="virtualizer">
        {data.map((item: unknown, index: number) => (
          <div key={index}>{children(item, index)}</div>
        ))}
      </div>
    )
  }
})

vi.mock('../chatVirtualizerRuntime', async () => {
  const { createElement } = await import('react')
  return {
    useChatVirtualizerRuntime: vi.fn(({ items, renderItem }) => ({
      contentRef: { current: null },
      keepMounted: [],
      scrollerProps: {
        onScroll: vi.fn(),
        onScrollEnd: vi.fn(),
        onWheel: vi.fn()
      },
      scrollerRef: { current: null },
      vlistHandleRef: { current: null },
      shift: runtimeMockState.shift,
      wrappedItems: items,
      wrappedRenderItem: (item: unknown, index: number) =>
        createElement('div', { 'data-testid': `item-${index}` }, renderItem(item, index))
    }))
  }
})

describe('MessageVirtualList', () => {
  beforeEach(() => {
    runtimeMockState.shift = false
  })

  it('renders the top padding as real scroll content before the virtualizer', () => {
    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
        topPadding={44}
      />
    )

    const spacer = document.querySelector('[data-message-virtual-list-top-spacer]')
    expect(spacer).toHaveStyle({ height: '44px' })
    expect(spacer?.nextElementSibling).toBe(screen.getByTestId('virtualizer'))
    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-start-margin', '44')
  })

  it('passes prepend shift compensation to virtua', () => {
    runtimeMockState.shift = true

    render(
      <MessageVirtualList
        items={['message-1']}
        getItemKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />
    )

    expect(screen.getByTestId('virtualizer')).toHaveAttribute('data-shift', 'true')
  })

  it('registers wheel handling as a native passive listener', async () => {
    const addEventListenerSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')

    try {
      render(
        <MessageVirtualList
          items={['message-1']}
          getItemKey={(item) => item}
          renderItem={(item) => <span>{item}</span>}
        />
      )

      await waitFor(() => {
        expect(addEventListenerSpy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true })
      })
    } finally {
      addEventListenerSpy.mockRestore()
    }
  })
})
