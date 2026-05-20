import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { droppableReorder } from '@renderer/utils/sort'
import type { ComposerQueueItem, StreamPendingQueueItem } from '@shared/ai/transport'
import { CornerDownRight, GripVertical, Pencil, X } from 'lucide-react'
import type React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type QueueKind = 'draft' | 'pending'
type QueueItemView =
  | { kind: 'draft'; item: ComposerQueueItem; index: number }
  | { kind: 'pending'; item: StreamPendingQueueItem; index: number }

interface Props {
  draftItems: ComposerQueueItem[]
  pendingItems: StreamPendingQueueItem[]
  canSteerDraft: boolean
  onSteerDraft: (item: ComposerQueueItem) => void | Promise<void>
  onEditDraft: (item: ComposerQueueItem) => void | Promise<void>
  onEditPending: (item: StreamPendingQueueItem) => void | Promise<void>
  onRemoveDraft: (item: ComposerQueueItem) => void | Promise<void>
  onRemovePending: (item: StreamPendingQueueItem) => void | Promise<void>
  onReorderDraft: (itemIds: string[]) => void | Promise<void>
  onReorderPending: (messageIds: string[]) => void | Promise<void>
}

const getTextPreview = (text: string) => text.trim().replace(/\s+/g, ' ')

const QueueIconButton = ({
  label,
  children,
  disabled,
  onClick
}: {
  label: string
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) => (
  <Tooltip content={label} delay={500}>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 rounded-md text-muted-foreground hover:bg-transparent hover:text-muted-foreground disabled:opacity-40"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        if (disabled) return
        onClick()
      }}>
      {children}
    </Button>
  </Tooltip>
)

export default function ComposerMessageQueuePanel({
  draftItems,
  pendingItems,
  canSteerDraft,
  onSteerDraft,
  onEditDraft,
  onEditPending,
  onRemoveDraft,
  onRemovePending,
  onReorderDraft,
  onReorderPending
}: Props) {
  const { t } = useTranslation()

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination || result.source.droppableId !== result.destination.droppableId) return
      if (result.source.index === result.destination.index) return

      if (result.source.droppableId === 'draft') {
        const reordered = droppableReorder(draftItems, result.source.index, result.destination.index)
        void onReorderDraft(reordered.map((item) => item.id))
        return
      }

      const reordered = droppableReorder(pendingItems, result.source.index, result.destination.index)
      void onReorderPending(reordered.map((item) => item.id))
    },
    [draftItems, onReorderDraft, onReorderPending, pendingItems]
  )

  const renderRows = (kind: QueueKind, items: QueueItemView['item'][]) => (
    <Droppable droppableId={kind}>
      {(dropProvided) => (
        <div ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
          {items.map((item, index) => {
            const row = { kind, item, index } as QueueItemView
            const isPending = row.kind === 'pending'
            const preview = getTextPreview(item.payload.text)
            const draftStatus = row.kind === 'draft' ? row.item.status : undefined

            return (
              <Draggable key={`${row.kind}:${item.id}`} draggableId={`${row.kind}:${item.id}`} index={index}>
                {(dragProvided, snapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    style={dragProvided.draggableProps.style}
                    className={cn(
                      'mx-1 flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                      snapshot.isDragging && 'bg-accent shadow-md'
                    )}>
                    <Tooltip
                      content={t('chat.input.queue.drag_to_reorder', { defaultValue: 'Drag to reorder' })}
                      delay={500}>
                      <span
                        {...dragProvided.dragHandleProps}
                        className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing"
                        aria-label={t('chat.input.queue.drag_to_reorder', { defaultValue: 'Drag to reorder' })}>
                        <GripVertical size={14} />
                      </span>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            isPending
                              ? 'bg-primary'
                              : draftStatus === 'failed'
                                ? 'bg-destructive'
                                : 'bg-muted-foreground/50'
                          )}
                        />
                        <span className="truncate">
                          {preview || t('chat.input.queue.empty', { defaultValue: 'Untitled' })}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                      {!isPending && (
                        <QueueIconButton
                          label={
                            canSteerDraft
                              ? t('chat.input.queue.steer', { defaultValue: 'Insert into current response' })
                              : t('chat.input.queue.steer_unavailable', {
                                  defaultValue: 'No active response to insert into'
                                })
                          }
                          disabled={!canSteerDraft}
                          onClick={() => void onSteerDraft(row.item)}>
                          <CornerDownRight size={14} />
                        </QueueIconButton>
                      )}
                      <QueueIconButton
                        label={t('common.edit')}
                        onClick={() => void (isPending ? onEditPending(row.item) : onEditDraft(row.item))}>
                        <Pencil size={14} />
                      </QueueIconButton>
                      <QueueIconButton
                        label={t('common.cancel')}
                        onClick={() => void (isPending ? onRemovePending(row.item) : onRemoveDraft(row.item))}>
                        <X size={14} />
                      </QueueIconButton>
                    </div>
                  </div>
                )}
              </Draggable>
            )
          })}
          {dropProvided.placeholder}
        </div>
      )}
    </Droppable>
  )

  if (draftItems.length + pendingItems.length === 0) return null

  return (
    <div
      className="mx-[35px] overflow-hidden rounded-t-lg border-border/60 border-x-[0.5px] border-t-[0.5px] bg-popover/80 text-popover-foreground backdrop-blur-[35px] backdrop-saturate-150"
      data-testid="composer-message-queue">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="max-h-36 overflow-auto py-1 [&::-webkit-scrollbar]:w-[3px]">
          {renderRows('pending', pendingItems)}
          {renderRows('draft', draftItems)}
        </div>
      </DragDropContext>
    </div>
  )
}
