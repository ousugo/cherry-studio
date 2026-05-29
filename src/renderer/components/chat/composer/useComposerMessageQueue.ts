import { useSharedCache } from '@renderer/data/hooks/useCache'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import type { ComposerQueuedMessagePayload, ComposerQueueItem, StreamPendingQueueItem } from '@shared/ai/transport'
import { useCallback, useMemo } from 'react'

export interface ComposerMessageQueue {
  draftItems: ComposerQueueItem[]
  pendingItems: StreamPendingQueueItem[]
  hasDraftItems: boolean
  canSteerDraft: boolean
  enqueueDraft: (payload: ComposerQueuedMessagePayload) => Promise<ComposerQueueItem>
  removeDraft: (itemId: string) => Promise<void>
  reorderDraft: (itemIds: string[]) => Promise<void>
  claimNextDraft: () => Promise<ComposerQueueItem | null>
  completeDraft: (itemId: string) => Promise<void>
  failDraft: (itemId: string, error?: string) => Promise<void>
  removePending: (messageId: string) => Promise<boolean>
  reorderPending: (messageIds: string[]) => Promise<boolean>
}

export function useComposerMessageQueue(scopeId: string, topicStreamId = scopeId): ComposerMessageQueue {
  const [draftSnapshot] = useSharedCache(`composer.queue.drafts.${scopeId}` as const)
  const { activeExecutions, isPending, pendingQueue } = useTopicStreamStatus(topicStreamId)

  const allDraftItems = useMemo(() => draftSnapshot?.items ?? [], [draftSnapshot])
  const draftItems = useMemo(() => allDraftItems.filter((item) => item.status !== 'sending'), [allDraftItems])
  const hasDraftItems = useMemo(() => allDraftItems.some((item) => item.status !== 'failed'), [allDraftItems])
  const pendingItems = useMemo(() => pendingQueue ?? [], [pendingQueue])
  const canSteerDraft = isPending && activeExecutions.length > 0

  const enqueueDraft = useCallback(
    (payload: ComposerQueuedMessagePayload) => window.api.composerQueue.enqueue(scopeId, payload),
    [scopeId]
  )

  const removeDraft = useCallback(
    async (itemId: string) => {
      await window.api.composerQueue.remove(scopeId, itemId)
    },
    [scopeId]
  )

  const reorderDraft = useCallback(
    async (itemIds: string[]) => {
      const orderedVisibleItems = new Map(itemIds.map((itemId, index) => [itemId, index]))
      const reorderedVisibleItems = [...draftItems].sort((left, right) => {
        return (
          (orderedVisibleItems.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderedVisibleItems.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        )
      })
      const nextVisibleItems = [...reorderedVisibleItems]
      const nextItemIds = allDraftItems.map((item) =>
        item.status === 'sending' ? item.id : (nextVisibleItems.shift()?.id ?? item.id)
      )

      await window.api.composerQueue.reorder(scopeId, nextItemIds)
    },
    [allDraftItems, draftItems, scopeId]
  )

  const claimNextDraft = useCallback(() => window.api.composerQueue.claimNext(scopeId), [scopeId])

  const completeDraft = useCallback(
    async (itemId: string) => {
      await window.api.composerQueue.complete(scopeId, itemId)
    },
    [scopeId]
  )

  const failDraft = useCallback(
    async (itemId: string, error?: string) => {
      await window.api.composerQueue.fail(scopeId, itemId, error)
    },
    [scopeId]
  )

  const removePending = useCallback(
    (messageId: string) => window.api.ai.queueRemove({ topicId: topicStreamId, messageId }),
    [topicStreamId]
  )

  const reorderPending = useCallback(
    (messageIds: string[]) => window.api.ai.queueReorder({ topicId: topicStreamId, messageIds }),
    [topicStreamId]
  )

  return useMemo(
    () => ({
      draftItems,
      pendingItems,
      hasDraftItems,
      canSteerDraft,
      enqueueDraft,
      removeDraft,
      reorderDraft,
      claimNextDraft,
      completeDraft,
      failDraft,
      removePending,
      reorderPending
    }),
    [
      canSteerDraft,
      claimNextDraft,
      completeDraft,
      draftItems,
      enqueueDraft,
      failDraft,
      hasDraftItems,
      pendingItems,
      removeDraft,
      removePending,
      reorderDraft,
      reorderPending
    ]
  )
}
