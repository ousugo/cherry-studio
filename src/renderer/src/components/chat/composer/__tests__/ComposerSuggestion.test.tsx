import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ComposerSuggestionItem, ComposerSuggestionList } from '../ComposerSuggestion'

vi.mock('@cherrystudio/ui', () => ({
  Flex: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
}))

vi.mock('i18next', () => ({
  t: (key: string, fallback?: string) => fallback ?? key
}))

const item = {
  id: 'resource-1',
  label: 'src/file.ts',
  command: vi.fn()
} satisfies ComposerSuggestionItem

const originalScrollIntoView = Element.prototype.scrollIntoView

function renderSuggestionList(command = vi.fn()) {
  render(
    <ComposerSuggestionList
      {...({
        command,
        editor: {},
        items: [item],
        query: '',
        range: { from: 1, to: 2 }
      } as any)}
    />
  )

  return command
}

function dispatchTargetKeyDown(key: string, options?: KeyboardEventInit) {
  const target = document.createElement('textarea')
  const downstreamHandler = vi.fn()
  target.addEventListener('keydown', downstreamHandler)
  document.body.appendChild(target)

  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...options
  })
  target.dispatchEvent(event)
  target.remove()

  return { downstreamHandler, event }
}

describe('ComposerSuggestionList', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it('captures Enter before the composer send shortcut and selects the active item', () => {
    const command = renderSuggestionList()

    const { downstreamHandler, event } = dispatchTargetKeyDown('Enter')

    expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'resource-1' }))
    expect(event.defaultPrevented).toBe(true)
    expect(downstreamHandler).not.toHaveBeenCalled()
  })

  it('captures Tab before composer token navigation and selects the active item', () => {
    const command = renderSuggestionList()

    const { downstreamHandler, event } = dispatchTargetKeyDown('Tab')

    expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'resource-1' }))
    expect(event.defaultPrevented).toBe(true)
    expect(downstreamHandler).not.toHaveBeenCalled()
  })
})
