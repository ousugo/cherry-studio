import type { Message } from '@shared/data/types/message'
import { describe, expect, it, vi } from 'vitest'

import { PendingMessageQueue } from '../PendingMessageQueue'

const makeMessage = (id: string, text: string): Message =>
  ({
    id,
    topicId: 'topic-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text }] },
    searchableText: text,
    status: 'success',
    siblingsGroupId: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }) as Message

describe('PendingMessageQueue', () => {
  it('updates, removes, and reorders unconsumed messages', () => {
    const queue = new PendingMessageQueue()
    queue.push(makeMessage('first', 'first'))
    queue.push(makeMessage('second', 'second'))
    queue.push(makeMessage('third', 'third'))

    expect(queue.update('second', makeMessage('second', 'updated'))).toBe(true)
    expect(queue.remove('first')).toBe(true)
    queue.reorder(['third', 'second'])

    expect(queue.list().map((message) => message.id)).toEqual(['third', 'second'])
    expect(queue.list()[1].data.parts?.[0]).toMatchObject({ type: 'text', text: 'updated' })
  })

  it('returns false when a message has already been consumed', () => {
    const queue = new PendingMessageQueue()
    queue.push(makeMessage('first', 'first'))

    expect(queue.drain().map((message) => message.id)).toEqual(['first'])
    expect(queue.remove('first')).toBe(false)
    expect(queue.update('first', makeMessage('first', 'updated'))).toBe(false)
  })

  it('notifies when queued messages are consumed', async () => {
    const onChange = vi.fn()
    const queue = new PendingMessageQueue(onChange)

    queue.push(makeMessage('first', 'first'))
    expect(onChange).toHaveBeenCalledTimes(1)

    expect(queue.drain().map((message) => message.id)).toEqual(['first'])
    expect(onChange).toHaveBeenCalledTimes(2)

    queue.push(makeMessage('second', 'second'))
    const iterator = queue[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: expect.objectContaining({ id: 'second' }),
      done: false
    })
    expect(onChange).toHaveBeenCalledTimes(4)
  })
})
