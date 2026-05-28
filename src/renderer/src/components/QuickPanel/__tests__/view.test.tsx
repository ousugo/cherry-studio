import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useQuickPanel } from '../hook'
import { QuickPanelProvider } from '../provider'
import type { QuickPanelContextType, QuickPanelInputAdapter, QuickPanelListItem, QuickPanelTriggerInfo } from '../types'
import { QuickPanelReservedSymbol } from '../types'
import { QuickPanelView } from '../view'

vi.mock('i18next', () => ({
  t: (key: string, fallback?: string) => fallback ?? key
}))

vi.mock('@renderer/utils', () => ({
  classNames: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({
      children,
      list,
      ref
    }: {
      children: (item: QuickPanelListItem, index: number) => React.ReactNode
      list: QuickPanelListItem[]
      ref?: React.Ref<{ scrollToIndex: (index: number) => void }>
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: vi.fn()
      }))

      return (
        <div data-testid="quick-panel-virtual-list">
          {list.map((item, index) => (
            <React.Fragment key={item.id ?? index}>{children(item, index)}</React.Fragment>
          ))}
        </div>
      )
    }
  }
})

function createKeyDownEvent(key: string) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  const stopPropagation = vi.spyOn(event, 'stopPropagation')

  return { event, preventDefault, stopPropagation }
}

function PanelHarness({
  captureDispatch,
  inputAdapter,
  items,
  manageListExternally,
  readOnly,
  symbol = QuickPanelReservedSymbol.Root,
  title = 'Actions',
  trackInputQuery
}: {
  captureDispatch: (dispatch: QuickPanelContextType['dispatchKeyDown']) => void
  inputAdapter?: QuickPanelInputAdapter
  items: QuickPanelListItem[]
  manageListExternally?: boolean
  readOnly?: boolean
  symbol?: string
  title?: string
  trackInputQuery?: boolean
}) {
  const { dispatchKeyDown, open } = useQuickPanel()

  useEffect(() => {
    captureDispatch(dispatchKeyDown)
  }, [captureDispatch, dispatchKeyDown])

  useEffect(() => {
    open({
      list: items,
      readOnly,
      symbol,
      title,
      triggerInfo: inputAdapter
        ? ({ type: 'input', position: 0, originalText: inputAdapter.getText() } satisfies QuickPanelTriggerInfo)
        : { type: 'button' },
      manageListExternally,
      trackInputQuery: trackInputQuery ?? Boolean(inputAdapter)
    })
  }, [inputAdapter, items, manageListExternally, open, readOnly, symbol, title, trackInputQuery])

  return <QuickPanelView inputAdapter={inputAdapter} />
}

describe('QuickPanelView', () => {
  it('renders read-only panels without row selection or confirm footer actions', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'server', label: 'filesystem', description: 'Connected', icon: 'mcp', isSelected: true, action }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} readOnly title="MCP" />
      </QuickPanelProvider>
    )

    await screen.findByText('filesystem')
    const row = screen.getByText('filesystem').closest('[data-id="server"]')
    expect(row?.getAttribute('data-active')).toBe('false')
    expect(row).not.toHaveAttribute('data-selected')

    fireEvent.click(row!)
    expect(action).not.toHaveBeenCalled()
    expect(screen.getByTestId('quick-panel')).toHaveClass('visible')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']

    for (const key of ['Enter', 'Tab']) {
      const { event, preventDefault, stopPropagation } = createKeyDownEvent(key)
      let handled = false
      act(() => {
        handled = dispatchKeyDown(event)
      })
      expect(handled).toBe(true)
      expect(preventDefault).toHaveBeenCalled()
      expect(stopPropagation).toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
      expect(screen.getByTestId('quick-panel')).toHaveClass('visible')
    }

    expect(screen.getByText('MCP')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.quickPanel.close' })).toBeInTheDocument()
    expect(screen.queryByText((content) => content.includes('Tab/↩︎'))).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.quickPanel.close' }))
    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })

  it('selects the active item with Tab', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const items: QuickPanelListItem[] = [
      { id: 'first', label: 'First action', icon: '1', action },
      { id: 'second', label: 'Second action', icon: '2', action: vi.fn() }
    ]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('First action')
    await waitFor(() => {
      expect(screen.getByText('First action').closest('[data-id="first"]')?.getAttribute('data-active')).toBe('true')
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event, preventDefault, stopPropagation } = createKeyDownEvent('Tab')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        item: expect.objectContaining({ id: 'first' })
      })
    )
  })

  it('does not select always-visible items with Tab when the panel is collapsed', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 8,
      getText: () => '/missing',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'clear', label: 'Clear query', icon: 'x', alwaysVisible: true, action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} />
      </QuickPanelProvider>
    )

    await screen.findByText('No results')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event } = createKeyDownEvent('Tab')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(action).not.toHaveBeenCalled()
  })

  it('tracks non-slash input queries and consumes the trigger range on selection', async () => {
    const action = vi.fn()
    const captureDispatch = vi.fn()
    const deleteTriggerRange = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange,
      focus: vi.fn(),
      getCursorOffset: () => 6,
      getText: () => '@notes',
      insertText: vi.fn()
    }
    const items: QuickPanelListItem[] = [{ id: 'notes', label: 'notes.md', icon: 'file', action }]

    render(
      <QuickPanelProvider>
        <PanelHarness captureDispatch={captureDispatch} inputAdapter={inputAdapter} items={items} symbol="@" />
      </QuickPanelProvider>
    )

    await screen.findByText('notes.md')

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    const { event } = createKeyDownEvent('Enter')

    let handled = false
    act(() => {
      handled = dispatchKeyDown(event)
    })

    expect(handled).toBe(true)
    expect(deleteTriggerRange).toHaveBeenCalledWith({ from: 0, to: 6 })
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enter',
        searchText: 'notes'
      })
    )
  })

  it('resets the active item when a tracked externally managed list is reopened', async () => {
    const captureDispatch = vi.fn()
    let inputText = '@a'
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => inputText.length,
      getText: () => inputText,
      insertText: vi.fn()
    }
    const initialItems: QuickPanelListItem[] = [
      { id: 'alpha', label: 'alpha.md', icon: 'file', action: vi.fn() },
      { id: 'beta', label: 'beta.md', icon: 'file', action: vi.fn() }
    ]
    const nextItems: QuickPanelListItem[] = [
      { id: 'alpine', label: 'alpine.md', icon: 'file', action: vi.fn() },
      { id: 'archived', label: 'archived.md', icon: 'file', disabled: true, action: vi.fn() }
    ]

    const { rerender } = render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={initialItems}
          manageListExternally
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('alpha.md').closest('[data-id="alpha"]')?.getAttribute('data-active')).toBe('true')
    })

    const dispatchKeyDown = captureDispatch.mock.calls.at(-1)?.[0] as QuickPanelContextType['dispatchKeyDown']
    act(() => {
      dispatchKeyDown(createKeyDownEvent('ArrowDown').event)
    })

    await waitFor(() => {
      expect(screen.getByText('beta.md').closest('[data-id="beta"]')?.getAttribute('data-active')).toBe('true')
    })

    inputText = '@al'
    rerender(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={nextItems}
          manageListExternally
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('alpine.md').closest('[data-id="alpine"]')?.getAttribute('data-active')).toBe('true')
    })
    expect(screen.getByText('archived.md').closest('[data-id="archived"]')?.getAttribute('data-active')).not.toBe(
      'true'
    )
  })

  it('closes a tracked non-slash input panel when whitespace terminates the query', async () => {
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 7,
      getText: () => '@notes ',
      insertText: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'notes', label: 'notes.md', icon: 'file', action: vi.fn() }]}
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })

  it('closes a tracked non-slash input panel when the cursor leaves the query end', async () => {
    const captureDispatch = vi.fn()
    const inputAdapter: QuickPanelInputAdapter = {
      deleteTriggerRange: vi.fn(),
      focus: vi.fn(),
      getCursorOffset: () => 3,
      getText: () => '@notes',
      insertText: vi.fn()
    }

    render(
      <QuickPanelProvider>
        <PanelHarness
          captureDispatch={captureDispatch}
          inputAdapter={inputAdapter}
          items={[{ id: 'notes', label: 'notes.md', icon: 'file', action: vi.fn() }]}
          symbol="@"
        />
      </QuickPanelProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('quick-panel')).not.toHaveClass('visible')
    })
  })
})
