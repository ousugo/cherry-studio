import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'

import Tools from '../index'

const mocks = vi.hoisted(() => ({
  showSearchPopup: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onPress,
    ...props
  }: React.PropsWithChildren<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      onPress?: React.MouseEventHandler<HTMLButtonElement>
    }
  >) => (
    <button type="button" {...props} onClick={onPress ?? props.onClick}>
      {children}
    </button>
  ),
  Tooltip: ({
    children,
    content,
    isOpen,
    onOpenChange
  }: React.PropsWithChildren<{
    content?: React.ReactNode
    delay?: number
    isOpen?: boolean
    onOpenChange?: (open: boolean) => void
  }>) => (
    <div
      data-testid={`tooltip-${content}`}
      data-open={String(Boolean(isOpen))}
      onMouseEnter={() => onOpenChange?.(true)}
      onMouseLeave={() => onOpenChange?.(false)}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/Popups/SearchPopup', () => ({
  default: {
    show: mocks.showSearchPopup
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ChatNavBar Tools', () => {
  it('renders the topic flow entry before search and calls its opener', () => {
    const onOpenTopicFlow = vi.fn()

    render(<Tools onOpenTopicFlow={onOpenTopicFlow} />)

    const topicFlowButton = screen.getByLabelText('chat.message.new.branch.label')
    const searchButton = screen.getByLabelText('chat.assistant.search.placeholder')

    expect(topicFlowButton.compareDocumentPosition(searchButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(topicFlowButton)
    expect(onOpenTopicFlow).toHaveBeenCalledTimes(1)
  })

  it('keeps the topic flow tooltip closed after opening until the pointer leaves', () => {
    const onOpenTopicFlow = vi.fn()

    render(<Tools onOpenTopicFlow={onOpenTopicFlow} />)

    const topicFlowButton = screen.getByLabelText('chat.message.new.branch.label')
    const topicFlowTooltip = screen.getByTestId('tooltip-chat.message.new.branch.label')

    fireEvent.mouseEnter(topicFlowTooltip)
    expect(topicFlowTooltip).toHaveAttribute('data-open', 'true')

    fireEvent.click(topicFlowButton)
    expect(topicFlowTooltip).toHaveAttribute('data-open', 'false')

    fireEvent.mouseEnter(topicFlowTooltip)
    expect(topicFlowTooltip).toHaveAttribute('data-open', 'false')

    fireEvent.pointerLeave(topicFlowButton)
    fireEvent.mouseEnter(topicFlowTooltip)
    expect(topicFlowTooltip).toHaveAttribute('data-open', 'true')
  })

  it('keeps the existing search entry', () => {
    render(<Tools />)

    fireEvent.click(screen.getByLabelText('chat.assistant.search.placeholder'))

    expect(mocks.showSearchPopup).toHaveBeenCalledTimes(1)
  })
})
