import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import NarrowLayout from '../NarrowLayout'

describe('NarrowLayout', () => {
  it('uses full width when narrow mode is disabled', () => {
    render(<NarrowLayout narrowMode={false}>Content</NarrowLayout>)

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('max-w-full')
    expect(layout).not.toHaveClass('max-w-[800px]')
    expect(layout).not.toHaveClass('active')
  })

  it('uses the narrow max width when narrow mode is enabled', () => {
    render(<NarrowLayout narrowMode>Content</NarrowLayout>)

    const layout = screen.getByText('Content')
    expect(layout).toHaveClass('active', 'max-w-[800px]')
    expect(layout).not.toHaveClass('max-w-full')
  })
})
