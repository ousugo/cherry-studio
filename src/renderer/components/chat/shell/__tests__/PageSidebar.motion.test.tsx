import { render } from '@testing-library/react'
import { Activity, type ComponentProps, type PropsWithChildren, useLayoutEffect, useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { PageSidebar } from '../PageSidebar'

const cache = vi.hoisted(() => ({ width: 200 }))
type MotionDivProps = ComponentProps<'div'> & {
  animate?: unknown
  initial?: unknown
  exit?: unknown
  transition?: unknown
}

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [cache.width, vi.fn()]
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: PropsWithChildren) => children,
  motion: {
    div: ({ animate, initial, exit, transition, ...props }: MotionDivProps) => {
      void animate
      void initial
      void exit
      void transition
      return <div {...props} />
    }
  }
}))

function RestoreStaleWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const resumed = useRef(false)

  useLayoutEffect(() => {
    if (resumed.current) {
      const pane = ref.current?.closest('[data-resource-list-pane]') as HTMLElement | null
      pane?.style.setProperty('width', '200px')
    }
    resumed.current = true
  }, [])

  return <div ref={ref} />
}

afterEach(() => {
  cache.width = 200
  document.documentElement.style.removeProperty('--assistants-width')
})

it('restores the current sidebar width after Activity resumes', () => {
  const Sidebar = ({ visible }: { visible: boolean }) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <PageSidebar open>
        <RestoreStaleWidth />
      </PageSidebar>
    </Activity>
  )

  const { container, rerender } = render(<Sidebar visible />)
  const pane = container.querySelector<HTMLElement>('[data-resource-list-pane]')

  cache.width = 283
  rerender(<Sidebar visible />)
  rerender(<Sidebar visible={false} />)
  rerender(<Sidebar visible />)

  expect(document.documentElement.style.getPropertyValue('--assistants-width')).toBe('283px')
  expect(pane?.style.width).toBe('var(--assistants-width)')
})
