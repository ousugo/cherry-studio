import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ComposerQueuedMessagePayload, ComposerQueueItem, ComposerQueueSnapshot } from '@shared/ai/transport'
import { IpcChannel } from '@shared/IpcChannel'

type QueueMutationResult = ComposerQueueSnapshot

const SENDING_CLAIM_TIMEOUT_MS = 30_000

const cloneQueueItem = (item: ComposerQueueItem): ComposerQueueItem => structuredClone(item)

interface ScopedItemRequest {
  scopeId: string
  itemId: string
}

interface ReorderRequest {
  scopeId: string
  itemIds: string[]
}

interface UpdateRequest extends ScopedItemRequest {
  payload: ComposerQueuedMessagePayload
}

interface FailRequest extends ScopedItemRequest {
  error?: string
}

@Injectable('ComposerQueueService')
@ServicePhase(Phase.WhenReady)
export class ComposerQueueService extends BaseService {
  private readonly queues = new Map<string, ComposerQueueItem[]>()

  protected async onInit(): Promise<void> {
    this.ipcHandle(IpcChannel.ComposerQueue_Enqueue, (_, scopeId: string, payload: ComposerQueuedMessagePayload) =>
      this.enqueue(scopeId, payload)
    )
    this.ipcHandle(IpcChannel.ComposerQueue_Remove, (_, request: ScopedItemRequest) =>
      this.remove(request.scopeId, request.itemId)
    )
    this.ipcHandle(IpcChannel.ComposerQueue_Reorder, (_, request: ReorderRequest) =>
      this.reorder(request.scopeId, request.itemIds)
    )
    this.ipcHandle(IpcChannel.ComposerQueue_Update, (_, request: UpdateRequest) =>
      this.update(request.scopeId, request.itemId, request.payload)
    )
    this.ipcHandle(IpcChannel.ComposerQueue_ClaimNext, (_, scopeId: string) => this.claimNext(scopeId))
    this.ipcHandle(IpcChannel.ComposerQueue_Complete, (_, request: ScopedItemRequest) =>
      this.complete(request.scopeId, request.itemId)
    )
    this.ipcHandle(IpcChannel.ComposerQueue_Fail, (_, request: FailRequest) =>
      this.fail(request.scopeId, request.itemId, request.error)
    )
  }

  enqueue(scopeId: string, payload: ComposerQueuedMessagePayload): ComposerQueueItem {
    this.assertScopeId(scopeId)
    this.assertPayload(payload)

    const now = new Date().toISOString()
    const item: ComposerQueueItem = {
      id: randomUUID(),
      scopeId,
      payload,
      status: 'queued',
      createdAt: now,
      updatedAt: now
    }

    this.getQueue(scopeId).push(item)
    this.broadcast(scopeId)
    return cloneQueueItem(item)
  }

  remove(scopeId: string, itemId: string): QueueMutationResult {
    const queue = this.getQueue(scopeId)
    const nextQueue = queue.filter((item) => item.id !== itemId)
    this.queues.set(scopeId, nextQueue)
    return this.broadcast(scopeId)
  }

  reorder(scopeId: string, itemIds: string[]): QueueMutationResult {
    const queue = this.getQueue(scopeId)
    const byId = new Map(queue.map((item) => [item.id, item]))
    const reordered: ComposerQueueItem[] = []

    for (const id of itemIds) {
      const item = byId.get(id)
      if (!item) continue
      reordered.push(item)
      byId.delete(id)
    }

    reordered.push(...byId.values())
    this.queues.set(scopeId, reordered)
    return this.broadcast(scopeId)
  }

  update(scopeId: string, itemId: string, payload: ComposerQueuedMessagePayload): ComposerQueueItem | null {
    this.assertPayload(payload)
    const item = this.replaceItem(scopeId, itemId, (current) => ({
      ...current,
      payload,
      status: 'queued',
      error: undefined,
      updatedAt: new Date().toISOString()
    }))
    if (!item) return null

    this.broadcast(scopeId)
    return cloneQueueItem(item)
  }

  claimNext(scopeId: string): ComposerQueueItem | null {
    const item = this.findClaimableItem(this.getQueue(scopeId))
    if (!item) return null

    const claimed = this.replaceItem(scopeId, item.id, (current) => ({
      ...current,
      status: 'sending',
      error: undefined,
      updatedAt: new Date().toISOString()
    }))
    if (!claimed) return null

    this.broadcast(scopeId)
    return cloneQueueItem(claimed)
  }

  complete(scopeId: string, itemId: string): QueueMutationResult {
    return this.remove(scopeId, itemId)
  }

  fail(scopeId: string, itemId: string, error?: string): ComposerQueueItem | null {
    const item = this.replaceItem(scopeId, itemId, (current) => ({
      ...current,
      status: 'failed',
      error,
      updatedAt: new Date().toISOString()
    }))
    if (!item) return null

    this.broadcast(scopeId)
    return cloneQueueItem(item)
  }

  snapshot(scopeId: string): ComposerQueueSnapshot {
    return { scopeId, items: this.getQueue(scopeId).map(cloneQueueItem) }
  }

  private getQueue(scopeId: string): ComposerQueueItem[] {
    this.assertScopeId(scopeId)
    const queue = this.queues.get(scopeId)
    if (queue) return queue

    const nextQueue: ComposerQueueItem[] = []
    this.queues.set(scopeId, nextQueue)
    return nextQueue
  }

  private replaceItem(
    scopeId: string,
    itemId: string,
    update: (item: ComposerQueueItem) => ComposerQueueItem
  ): ComposerQueueItem | null {
    const queue = this.getQueue(scopeId)
    const index = queue.findIndex((current) => current.id === itemId)
    if (index === -1) return null

    const item = update(queue[index])
    const nextQueue = [...queue]
    nextQueue[index] = item
    this.queues.set(scopeId, nextQueue)
    return item
  }

  private broadcast(scopeId: string): ComposerQueueSnapshot {
    const snapshot = this.snapshot(scopeId)
    application.get('CacheService').setShared(`composer.queue.drafts.${scopeId}` as const, snapshot)
    return snapshot
  }

  private assertScopeId(scopeId: string): void {
    if (typeof scopeId !== 'string' || scopeId.trim().length === 0) {
      throw new Error('Composer queue scopeId is required')
    }
  }

  private assertPayload(payload: ComposerQueuedMessagePayload): void {
    if (!payload || typeof payload.text !== 'string' || !Array.isArray(payload.userMessageParts)) {
      throw new Error('Invalid composer queue payload')
    }
  }

  private findClaimableItem(queue: ComposerQueueItem[]): ComposerQueueItem | null {
    const now = Date.now()

    for (const item of queue) {
      if (item.status === 'failed') continue
      if (item.status === 'queued') return item

      const updatedAt = Date.parse(item.updatedAt)
      if (Number.isNaN(updatedAt) || now - updatedAt >= SENDING_CLAIM_TIMEOUT_MS) return item

      return null
    }

    return null
  }
}
