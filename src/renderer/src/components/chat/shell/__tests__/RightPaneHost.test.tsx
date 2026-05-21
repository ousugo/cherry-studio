import { render, screen } from '@testing-library/react'
import type { HTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { RightPaneHost } from '../RightPaneHost'

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: PropsWithChildren) => <>{children}</>
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  transition?: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: MotionDivProps) => {
      const domProps = { ...props }
      delete domProps.animate
      delete domProps.exit
      delete domProps.initial
      delete domProps.transition

      return <div {...domProps}>{children}</div>
    }
  }
}))

describe('RightPaneHost', () => {
  it('constrains the right pane to the chat shell height while preserving width', () => {
    render(
      <RightPaneHost open width={460}>
        <div>artifact pane</div>
      </RightPaneHost>
    )

    const host = screen.getByText('artifact pane').parentElement

    expect(host).toHaveClass('h-full', 'min-h-0', 'shrink-0', 'overflow-hidden')
  })
})
