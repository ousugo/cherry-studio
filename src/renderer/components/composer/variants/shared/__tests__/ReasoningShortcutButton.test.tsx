import type { ComposerToolLauncher } from '@renderer/components/composer/toolLauncher'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Lightbulb } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReasoningShortcutButton } from '../ReasoningShortcutButton'

const submenuItem = (id: string, overrides: Partial<ComposerToolLauncher> = {}): ComposerToolLauncher => ({
  id: `thinking-${id}`,
  kind: 'command',
  label: id,
  icon: <Lightbulb />,
  sources: ['popover'],
  ...overrides
})

const buildLauncher = (overrides: Partial<ComposerToolLauncher> = {}): ComposerToolLauncher => ({
  id: 'thinking',
  kind: 'group',
  label: 'Reasoning effort',
  icon: <Lightbulb />,
  sources: ['popover'],
  ...overrides
})

const renderShortcut = (
  launcher: ComposerToolLauncher,
  onClick = vi.fn(),
  onExpansionOffsetChange?: (offset: number) => void
) => {
  const result = render(
    <QuickPanelProvider>
      <ReasoningShortcutButton
        disabled={Boolean(launcher.disabled)}
        label="Reasoning effort"
        launcher={launcher}
        onClick={onClick}
        onExpansionOffsetChange={onExpansionOffsetChange}
      />
    </QuickPanelProvider>
  )
  const suffix = typeof launcher.suffix === 'string' ? `: ${launcher.suffix}` : ''
  return {
    ...result,
    button: screen.getByRole('button', { name: `Reasoning effort${suffix}` }),
    onClick
  }
}

describe('ReasoningShortcutButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('expands on hover intent or keyboard focus and opens the reasoning panel', () => {
    const onExpansionOffsetChange = vi.fn()
    const { button, onClick } = renderShortcut(buildLauncher({ suffix: 'High' }), vi.fn(), onExpansionOffsetChange)
    Object.defineProperty(button.firstElementChild, 'scrollWidth', { configurable: true, value: 64 })

    fireEvent.mouseEnter(button)
    void act(() => vi.advanceTimersByTime(99))
    expect(button).toHaveAttribute('data-expanded', 'false')

    void act(() => vi.advanceTimersByTime(1))
    expect(button).toHaveAttribute('data-expanded', 'true')
    expect(onExpansionOffsetChange).toHaveBeenLastCalledWith(25)

    fireEvent.mouseLeave(button)
    expect(button).toHaveAttribute('data-expanded', 'false')
    expect(onExpansionOffsetChange).toHaveBeenLastCalledWith(0)

    fireEvent.focus(button)
    expect(button).toHaveAttribute('data-expanded', 'true')

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps the toolbar expansion offset stable while the reasoning level changes', () => {
    const onExpansionOffsetChange = vi.fn()
    const initialLauncher = buildLauncher({ suffix: 'Low' })
    const { button, rerender } = renderShortcut(initialLauncher, vi.fn(), onExpansionOffsetChange)
    Object.defineProperty(button.firstElementChild, 'scrollWidth', { configurable: true, value: 64 })
    fireEvent.focus(button)
    expect(onExpansionOffsetChange).toHaveBeenLastCalledWith(25)

    onExpansionOffsetChange.mockClear()
    rerender(
      <QuickPanelProvider>
        <ReasoningShortcutButton
          disabled={false}
          label="Reasoning effort"
          launcher={buildLauncher({ suffix: 'High' })}
          onClick={vi.fn()}
          onExpansionOffsetChange={onExpansionOffsetChange}
        />
      </QuickPanelProvider>
    )

    expect(onExpansionOffsetChange).not.toHaveBeenCalled()
  })

  it('keeps the collapsed icon centered and shows the wheel hint', () => {
    const { button } = renderShortcut(buildLauncher({ suffix: 'High' }))
    const suffix = button.querySelector('.transition-opacity')

    expect(button).toHaveClass('justify-start', 'px-1.5', 'data-[expanded=true]:px-2')
    expect(suffix).toHaveClass('truncate', 'transition-opacity')
    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-title', '滚轮切换思维链长度')
  })

  it('accumulates trackpad movement and invokes the adjacent existing action', () => {
    const turnOff = vi.fn()
    const selectMedium = vi.fn()
    const { button } = renderShortcut(
      buildLauncher({
        suffix: 'Low',
        submenu: [
          submenuItem('none', { action: turnOff }),
          submenuItem('low', { active: true }),
          submenuItem('medium', { action: selectMedium })
        ]
      })
    )
    fireEvent.focus(button)
    fireEvent.mouseEnter(screen.getByTestId('tooltip'))
    expect(screen.getByTestId('tooltip-content')).toHaveTextContent('滚轮切换思维链长度')

    expect(fireEvent.wheel(button, { deltaY: -20 })).toBe(false)
    expect(screen.queryByTestId('tooltip-content')).not.toBeInTheDocument()
    expect(turnOff).not.toHaveBeenCalled()

    fireEvent.wheel(button, { deltaY: -12 })
    expect(turnOff).toHaveBeenCalledTimes(1)

    fireEvent.mouseLeave(button)
    fireEvent.focus(button)
    fireEvent.wheel(button, { deltaY: 32 })
    expect(selectMedium).toHaveBeenCalledTimes(1)
  })

  it('changes only one level per continuous gesture and unlocks when direction reverses', () => {
    const selectLow = vi.fn()
    const selectMedium = vi.fn()
    const selectHigh = vi.fn()
    const { button } = renderShortcut(
      buildLauncher({
        suffix: 'Low',
        submenu: [
          submenuItem('low', { active: true, action: selectLow }),
          submenuItem('medium', { action: selectMedium }),
          submenuItem('high', { action: selectHigh })
        ]
      })
    )
    fireEvent.focus(button)

    fireEvent.wheel(button, { deltaY: 32 })
    fireEvent.wheel(button, { deltaY: 64 })

    expect(selectMedium).toHaveBeenCalledTimes(1)
    expect(selectHigh).not.toHaveBeenCalled()

    fireEvent.wheel(button, { deltaY: -32 })
    expect(selectLow).toHaveBeenCalledTimes(1)

    void act(() => vi.advanceTimersByTime(180))
    fireEvent.wheel(button, { deltaY: 32 })
    expect(selectMedium).toHaveBeenCalledTimes(2)
  })

  it('bounces the button at the top boundary while preserving page scrolling and browser zoom gestures', () => {
    const { button } = renderShortcut(
      buildLauncher({
        suffix: 'Low',
        submenu: [submenuItem('low', { active: true })]
      })
    )
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    Object.defineProperty(button, 'animate', { configurable: true, value: animate })
    fireEvent.focus(button)

    expect(fireEvent.wheel(button, { deltaY: -40 })).toBe(true)
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: 'translateY(0px)' },
        { offset: 0.3, transform: 'translateY(-6px)' },
        { offset: 0.72, transform: 'translateY(1.5px)' },
        { transform: 'translateY(0px)' }
      ],
      { duration: 220, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' }
    )

    expect(fireEvent.wheel(button, { deltaY: -40 })).toBe(true)
    expect(animate).toHaveBeenCalledTimes(1)
    expect(fireEvent.wheel(button, { ctrlKey: true, deltaY: -40 })).toBe(true)
    expect(fireEvent.wheel(button, { metaKey: true, deltaY: -40 })).toBe(true)
  })

  it('enters the first exposed option when the internal default has no active submenu item', () => {
    const turnOff = vi.fn()
    const { button } = renderShortcut(
      buildLauncher({
        suffix: 'Default',
        submenu: [submenuItem('none', { action: turnOff }), submenuItem('low', { action: vi.fn() })]
      })
    )
    fireEvent.focus(button)
    fireEvent.wheel(button, { deltaY: 32 })

    expect(turnOff).toHaveBeenCalledTimes(1)
  })
})
