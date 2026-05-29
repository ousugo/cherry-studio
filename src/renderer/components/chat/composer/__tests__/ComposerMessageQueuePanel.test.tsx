import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import type * as ReactI18nextModule from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import ComposerMessageQueuePanel from '../ComposerMessageQueuePanel'

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as
    | ((result: {
        source: { droppableId: string; index: number }
        destination?: { droppableId: string; index: number } | null
      }) => void)
    | undefined
}))

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({
    children,
    onDragEnd
  }: {
    children: React.ReactNode
    onDragEnd: NonNullable<typeof dnd.onDragEnd>
  }) => {
    dnd.onDragEnd = onDragEnd
    return <div>{children}</div>
  },
  Droppable: ({ children }: { children: (provided: any) => React.ReactNode }) =>
    children({ droppableProps: {}, innerRef: vi.fn(), placeholder: null }),
  Draggable: ({
    children,
    draggableId
  }: {
    children: (provided: any, snapshot: { isDragging: boolean }) => React.ReactNode
    draggableId: string
  }) =>
    children(
      {
        draggableProps: { style: {} },
        dragHandleProps: { 'data-testid': `drag-handle-${draggableId}` },
        innerRef: vi.fn()
      },
      { isDragging: false }
    )
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18nextModule>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)
    })
  }
})

describe('ComposerMessageQueuePanel', () => {
  it('renders draft and pending items and routes edit/cancel actions', () => {
    const onEditDraft = vi.fn()
    const onEditPending = vi.fn()
    const onRemoveDraft = vi.fn()
    const onRemovePending = vi.fn()
    const onReorderDraft = vi.fn()
    const onSteerDraft = vi.fn()

    render(
      <ComposerMessageQueuePanel
        draftItems={[
          {
            id: 'draft-1',
            scopeId: 'topic-1',
            status: 'queued',
            payload: { text: 'draft item', userMessageParts: [{ type: 'text', text: 'draft item' }] },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]}
        pendingItems={[
          {
            id: 'pending-1',
            payload: { text: 'pending item', userMessageParts: [{ type: 'text', text: 'pending item' }] },
            executionIds: ['provider::model']
          }
        ]}
        canSteerDraft
        onSteerDraft={onSteerDraft}
        onEditDraft={onEditDraft}
        onEditPending={onEditPending}
        onRemoveDraft={onRemoveDraft}
        onRemovePending={onRemovePending}
        onReorderDraft={onReorderDraft}
        onReorderPending={vi.fn()}
      />
    )

    expect(screen.getByText('draft item')).toBeInTheDocument()
    expect(screen.getByText('pending item')).toBeInTheDocument()
    expect(screen.getAllByTestId(/drag-handle-/)).toHaveLength(2)

    fireEvent.click(screen.getByLabelText('Insert into current response'))
    expect(onSteerDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }))

    const editButtons = screen.getAllByLabelText('common.edit')
    fireEvent.click(editButtons[0])
    fireEvent.click(editButtons[1])
    expect(onEditPending).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-1' }))
    expect(onEditDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }))

    const cancelButtons = screen.getAllByLabelText('common.cancel')
    fireEvent.click(cancelButtons[0])
    fireEvent.click(cancelButtons[1])
    expect(onRemovePending).toHaveBeenCalledWith(expect.objectContaining({ id: 'pending-1' }))
    expect(onRemoveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }))
  })

  it('routes drag reorders by item kind', () => {
    const onReorderDraft = vi.fn()

    render(
      <ComposerMessageQueuePanel
        draftItems={[
          {
            id: 'draft-1',
            scopeId: 'topic-1',
            status: 'queued',
            payload: { text: 'first', userMessageParts: [{ type: 'text', text: 'first' }] },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          {
            id: 'draft-2',
            scopeId: 'topic-1',
            status: 'queued',
            payload: { text: 'second', userMessageParts: [{ type: 'text', text: 'second' }] },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ]}
        pendingItems={[]}
        canSteerDraft={false}
        onSteerDraft={vi.fn()}
        onEditDraft={vi.fn()}
        onEditPending={vi.fn()}
        onRemoveDraft={vi.fn()}
        onRemovePending={vi.fn()}
        onReorderDraft={onReorderDraft}
        onReorderPending={vi.fn()}
      />
    )

    dnd.onDragEnd?.({
      source: { droppableId: 'draft', index: 0 },
      destination: { droppableId: 'draft', index: 1 }
    })

    expect(onReorderDraft).toHaveBeenCalledWith(['draft-2', 'draft-1'])
  })
})
