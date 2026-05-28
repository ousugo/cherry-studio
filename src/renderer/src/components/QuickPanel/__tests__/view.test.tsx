import { act, render, screen, waitFor } from '@testing-library/react'
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
  items
}: {
  captureDispatch: (dispatch: QuickPanelContextType['dispatchKeyDown']) => void
  inputAdapter?: QuickPanelInputAdapter
  items: QuickPanelListItem[]
}) {
  const { dispatchKeyDown, open } = useQuickPanel()

  useEffect(() => {
    captureDispatch(dispatchKeyDown)
  }, [captureDispatch, dispatchKeyDown])

  useEffect(() => {
    open({
      list: items,
      symbol: QuickPanelReservedSymbol.Root,
      title: 'Actions',
      triggerInfo: inputAdapter
        ? ({ type: 'input', position: 0, originalText: inputAdapter.getText() } satisfies QuickPanelTriggerInfo)
        : { type: 'button' }
    })
  }, [inputAdapter, items, open])

  return <QuickPanelView inputAdapter={inputAdapter} />
}

describe('QuickPanelView', () => {
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
})
