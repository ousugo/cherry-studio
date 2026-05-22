import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

import { FileTree } from '../FileTree'
import type { FileTreeNode, FileTreeProps } from '../types'

afterEach(() => {
  cleanup()
})

const nodes: FileTreeNode[] = [
  {
    id: 'root',
    name: 'Root',
    kind: 'folder',
    path: 'root',
    children: [
      { id: 'a', name: 'A.md', kind: 'file', path: 'root/a.md' },
      {
        id: 'sub',
        name: 'Sub',
        kind: 'folder',
        path: 'root/sub',
        children: [{ id: 'b', name: 'B.md', kind: 'file', path: 'root/sub/b.md' }]
      }
    ]
  }
]

/**
 * Bypass virtualization in tests by rendering a plain list - DynamicVirtualList
 * needs a sized scroll container which jsdom does not provide.
 */
const passthroughRenderList: NonNullable<FileTreeProps['renderList']> = ({ flat, renderItem }) => (
  <div data-testid="passthrough-list">{flat.map((_item, index) => renderItem(index))}</div>
)

describe('FileTree - read-only form (no callbacks)', () => {
  it('renders rows without drag support', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow).toHaveAttribute('draggable', 'false')
  })

  it('does not render rename input when renameSlot is omitted', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('does not render row extras when renderRowExtras is omitted', () => {
    render(<FileTree nodes={nodes} renderList={passthroughRenderList} />)
    expect(screen.queryByTestId('row-extras')).toBeNull()
  })

  it('toggles expand on chevron click', async () => {
    const user = userEvent.setup()
    render(<FileTree nodes={nodes} renderList={passthroughRenderList} />)
    expect(screen.queryByText('A.md')).toBeNull()
    const chevron = screen.getByText('Root').parentElement!.querySelector('button')!
    await user.click(chevron)
    expect(screen.getByText('A.md')).toBeInTheDocument()
  })

  it('reports selection through onSelectedChange', async () => {
    const onSelectedChange = vi.fn()
    const user = userEvent.setup()
    render(<FileTree nodes={nodes} onSelectedChange={onSelectedChange} renderList={passthroughRenderList} />)
    await user.click(screen.getByText('Root'))
    expect(onSelectedChange).toHaveBeenCalledWith('root')
  })

  it('truncates labels by default', () => {
    render(<FileTree nodes={nodes} defaultExpandedIds={new Set(['root'])} renderList={passthroughRenderList} />)

    expect(screen.getByText('A.md')).toHaveClass('truncate')
  })
})

describe('FileTree - editable form (all callbacks)', () => {
  it('renders rows as draggable when onMove is provided', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renderList={passthroughRenderList}
      />
    )
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow).toHaveAttribute('draggable', 'true')
  })

  it('renders rename input when renameSlot returns true for a node', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renameSlot={{
          isRenaming: (n) => n.id === 'a',
          inputProps: { value: 'A.md', onChange: () => {} }
        }}
        renderList={passthroughRenderList}
      />
    )
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('A.md')
  })

  it('disables dragging on the row being renamed', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renameSlot={{
          isRenaming: (n) => n.id === 'a',
          inputProps: { value: 'A.md', onChange: () => {} }
        }}
        renderList={passthroughRenderList}
      />
    )
    const renamedRow = screen.getByRole('textbox').closest('[data-node-id="a"]')!
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(renamedRow).toHaveAttribute('draggable', 'false')
    expect(rootRow).toHaveAttribute('draggable', 'true')
  })

  it('renders renderRowExtras for every row', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        onMove={() => {}}
        renderRowExtras={(n) => <span data-testid={`extra-${n.id}`}>x</span>}
        renderList={passthroughRenderList}
      />
    )
    expect(screen.getByTestId('extra-root')).toBeInTheDocument()
    expect(screen.getByTestId('extra-a')).toBeInTheDocument()
  })

  it('opens row context menu from the whole row when renderContextMenu is provided', () => {
    render(
      <FileTree
        nodes={nodes}
        defaultExpandedIds={new Set(['root'])}
        renderContextMenu={(n) => <span data-testid={`menu-${n.id}`}>Menu for {n.name}</span>}
        renderList={passthroughRenderList}
      />
    )

    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    act(() => {
      fireEvent.contextMenu(rootRow)
    })

    expect(screen.getByTestId('menu-root')).toHaveTextContent('Menu for Root')
  })
})

describe('FileTree - icon behaviour', () => {
  it('shows FolderOpen when expanded and Folder when collapsed', () => {
    const { rerender } = render(<FileTree nodes={nodes} expandedIds={new Set()} renderList={passthroughRenderList} />)
    const rootRow = screen.getByText('Root').closest('[data-node-id="root"]')!
    // collapsed: data-expanded=false on the kind attribute is implicit; check icons directly
    expect(rootRow.querySelector('svg.lucide-folder')).toBeTruthy()
    rerender(<FileTree nodes={nodes} expandedIds={new Set(['root'])} renderList={passthroughRenderList} />)
    const rootRow2 = screen.getByText('Root').closest('[data-node-id="root"]')!
    expect(rootRow2.querySelector('svg.lucide-folder-open')).toBeTruthy()
  })
})
