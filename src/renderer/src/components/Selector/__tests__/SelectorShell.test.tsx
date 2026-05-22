import { render, screen, waitFor } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { openAutoFocusEvents, popoverContentProps } = vi.hoisted(() => ({
  openAutoFocusEvents: [] as Array<{ preventDefault: ReturnType<typeof vi.fn>; defaultPrevented: boolean }>,
  popoverContentProps: [] as Array<{ align?: string; side?: string; sideOffset?: number; collisionPadding?: number }>
}))

const originalResizeObserver = globalThis.ResizeObserver

vi.mock('@cherrystudio/ui', () => ({
  Input: ({ ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
    <input ref={ref} {...props} />
  ),
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({
    children,
    onOpenAutoFocus,
    align,
    side,
    sideOffset,
    collisionPadding,
    portalContainer,
    forceMount,
    onInteractOutside,
    ...props
  }: {
    children: ReactNode
    onOpenAutoFocus?: (event: { preventDefault: () => void; defaultPrevented: boolean }) => void
    align?: string
    side?: string
    sideOffset?: number
    collisionPadding?: number
    portalContainer?: unknown
    forceMount?: unknown
    onInteractOutside?: unknown
  }) => {
    popoverContentProps.push({ align, side, sideOffset, collisionPadding })
    void portalContainer
    void forceMount
    void onInteractOutside
    const event = {
      preventDefault: vi.fn(() => {
        event.defaultPrevented = true
      }),
      defaultPrevented: false
    }
    openAutoFocusEvents.push(event)
    onOpenAutoFocus?.(event)
    return <div {...props}>{children}</div>
  },
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Switch: () => <button type="button" role="switch" />
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

import { SelectorShell } from '../shell/SelectorShell'

describe('SelectorShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.ResizeObserver = originalResizeObserver
    openAutoFocusEvents.length = 0
    popoverContentProps.length = 0
  })

  it('defaults popover placement to bottom with viewport padding', () => {
    render(
      <SelectorShell trigger={<button type="button">Open</button>} open onOpenChange={vi.fn()}>
        <div />
      </SelectorShell>
    )

    expect(popoverContentProps.at(-1)).toMatchObject({
      side: 'bottom',
      align: 'start',
      sideOffset: 4,
      collisionPadding: 12
    })
  })

  it('lets contentProps override collision padding', () => {
    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        contentProps={{ collisionPadding: 24 }}>
        <div />
      </SelectorShell>
    )

    expect(popoverContentProps.at(-1)).toMatchObject({ collisionPadding: 24 })
  })

  it('subtracts selector chrome from available list height', async () => {
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      const isContent = element instanceof HTMLElement && element.getAttribute('data-selector-shell-content') === 'true'
      if (!isContent) return style

      Object.defineProperties(style, {
        paddingTop: { configurable: true, value: '4px' },
        paddingBottom: { configurable: true, value: '4px' }
      })
      vi.spyOn(style, 'getPropertyValue').mockImplementation((property: string) =>
        property === '--radix-popover-content-available-height'
          ? '200px'
          : CSSStyleDeclaration.prototype.getPropertyValue.call(style, property)
      )
      return style
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isChrome = this.hasAttribute('data-selector-shell-chrome')
      return {
        x: 0,
        y: 0,
        width: 320,
        height: isChrome ? 20 : 0,
        top: 0,
        right: 320,
        bottom: isChrome ? 20 : 0,
        left: 0,
        toJSON: () => {}
      }
    })

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter</span>}
        multiSelect={{ label: 'Multi', checked: false, onCheckedChange: vi.fn() }}
        bottomAction={{ label: 'Create', onClick: vi.fn() }}>
        {({ availableListHeight }) => <div data-testid="available-height">{availableListHeight}</div>}
      </SelectorShell>
    )

    await waitFor(() => expect(screen.getByTestId('available-height')).toHaveTextContent('112'))
  })

  it('does not force focus into search when search autoFocus is false', async () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search',
          autoFocus: false
        }}>
        <div />
      </SelectorShell>
    )

    await waitFor(() => expect(openAutoFocusEvents).toHaveLength(1))
    expect(openAutoFocusEvents[0]?.preventDefault).not.toHaveBeenCalled()
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('does not build lazy-kept content before the first open', () => {
    const renderContent = vi.fn(() => <div data-testid="lazy-body" />)

    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open={false}
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep">
        {renderContent}
      </SelectorShell>
    )

    expect(renderContent).not.toHaveBeenCalled()
    expect(screen.queryByTestId('lazy-body')).not.toBeInTheDocument()
  })

  it('stabilizes bottom lazy-kept placement before available height is measured', () => {
    render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        mountStrategy="lazy-keep"
        side="bottom">
        {({ availableListHeight }) => <div data-testid="available-height">{String(availableListHeight)}</div>}
      </SelectorShell>
    )

    expect(screen.getByTestId('available-height')).toHaveTextContent('0')
  })

  it('does not rebind measurement listeners when config object identities change', async () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    globalThis.ResizeObserver = vi.fn(
      () =>
        ({
          observe,
          disconnect
        }) as unknown as ResizeObserver
    ) as unknown as typeof ResizeObserver
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    const { rerender } = render(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter</span>}>
        <div />
      </SelectorShell>
    )

    await waitFor(() => expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function)))
    const resizeListenerCount = addEventListenerSpy.mock.calls.filter(
      ([eventName]) => (eventName as string) === 'resize'
    ).length
    const disconnectCount = disconnect.mock.calls.length

    rerender(
      <SelectorShell
        trigger={<button type="button">Open</button>}
        open
        onOpenChange={vi.fn()}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search' }}
        filterContent={<span>Filter again</span>}>
        <div />
      </SelectorShell>
    )

    expect(addEventListenerSpy.mock.calls.filter(([eventName]) => (eventName as string) === 'resize')).toHaveLength(
      resizeListenerCount
    )
    expect(disconnect).toHaveBeenCalledTimes(disconnectCount)
  })
})
