import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationShell from '../ConversationShell'

const shellProps = vi.hoisted(() => ({
  current: null as {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
  } | null
}))

vi.mock('@renderer/components/QuickPanel', () => ({
  QuickPanelProvider: ({ children }: { children: ReactNode }) => <div data-testid="quick-panel">{children}</div>
}))

vi.mock('../ChatAppShell', () => ({
  ChatAppShell: (props: {
    centerContent?: ReactNode
    topBar?: ReactNode
    sidePanel?: ReactNode
    centerOverlay?: ReactNode
  }) => {
    shellProps.current = props
    return (
      <div data-testid="chat-app-shell">
        {props.topBar}
        {props.sidePanel}
        {props.centerContent}
        {props.centerOverlay}
      </div>
    )
  }
}))

describe('ConversationShell', () => {
  it('wraps center content in the shared app shell and keeps right pane beside it', () => {
    render(
      <ConversationShell
        id="conversation"
        className="message-style"
        topBar={<div data-testid="top-bar" />}
        sidePanel={<div data-testid="side-panel" />}
        center={<div data-testid="center" />}
        centerOverlay={<div data-testid="center-overlay" />}
        rightPane={<div data-testid="right-pane" />}
      />
    )

    expect(screen.getByTestId('quick-panel')).toContainElement(screen.getByTestId('chat-app-shell'))
    expect(screen.getByTestId('chat-app-shell')).toContainElement(screen.getByTestId('center'))
    expect(screen.getByTestId('chat-app-shell')).toContainElement(screen.getByTestId('center-overlay'))
    expect(screen.getByTestId('right-pane')).toBeInTheDocument()
    expect(shellProps.current?.centerContent).toBeTruthy()
    expect(document.getElementById('conversation')).toHaveClass('message-style')
  })
})
