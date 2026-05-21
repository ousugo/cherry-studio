import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatBottomOverlayInset } from '../../layout/ChatViewportInsetContext'
import ComposerDockTransitionFrame from '../ComposerDockTransitionFrame'

function rect(top: number, bottom: number, left = 0, right = 1020): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function InsetProbe() {
  const insets = useChatBottomOverlayInset()
  return (
    <>
      <div data-testid="content-bottom-padding">{String(insets?.contentBottomPadding)}</div>
      <div data-testid="scroller-bottom-margin">{String(insets?.scrollerBottomMargin)}</div>
    </>
  )
}

describe('ComposerDockTransitionFrame', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(
      this: HTMLElement
    ) {
      if (this.hasAttribute('data-composer-inputbar')) {
        return rect(620, 820)
      }
      if (this.hasAttribute('data-composer-dock-surface')) {
        return rect(600, 820)
      }
      if (this.hasAttribute('data-message-virtual-list-scroller')) {
        return rect(0, 900, 8, 1008)
      }

      return rect(0, 900)
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
      if (this.hasAttribute('data-message-virtual-list-scroller')) return 988
      return 1020
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('separates message content padding from scroll container bottom margin', async () => {
    render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('content-bottom-padding')).toHaveTextContent('236')
      expect(screen.getByTestId('scroller-bottom-margin')).toHaveTextContent('80')
    })
  })

  it('does not add a separate dock-side padding outside the composer layout', () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={<InsetProbe />}
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    expect(container.querySelector('[data-composer-dock-layer]')).not.toHaveClass('px-4')
  })

  it('aligns composer width to the message scroller viewport', async () => {
    const { container } = render(
      <ComposerDockTransitionFrame
        placement="docked"
        main={
          <>
            <InsetProbe />
            <div data-message-virtual-list-scroller="" />
          </>
        }
        composer={<div data-composer-inputbar="" />}
        mainVisible
      />
    )

    await waitFor(() => {
      const dockLayer = container.querySelector<HTMLElement>('[data-composer-dock-layer]')
      expect(dockLayer).toHaveStyle({ paddingInlineStart: '8px', paddingInlineEnd: '24px' })
    })
  })
})
