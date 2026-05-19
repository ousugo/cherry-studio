import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  dataApiDelete: vi.fn(),
  dataApiPatch: vi.fn(),
  dataApiPost: vi.fn()
}))

vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: mocks.cacheGet,
    set: mocks.cacheSet
  }
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    delete: mocks.dataApiDelete,
    patch: mocks.dataApiPatch,
    post: mocks.dataApiPost
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

import { useTemporaryConversation } from '../useTemporaryConversation'

describe('useTemporaryConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cacheGet.mockReturnValue(null)
    mocks.dataApiDelete.mockResolvedValue(undefined)
    mocks.dataApiPatch.mockResolvedValue(undefined)
  })

  it('keeps the current temporary conversation visible while replacing it', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'assistant' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-topic-1',
      messages: []
    })

    await act(async () => {
      await result.current.start({ assistantId: 'assistant-1' })
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-1'
    })

    let resolveNextTopic!: (value: { id: string; messages: [] }) => void
    mocks.dataApiPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNextTopic = resolve
      })
    )

    let replacePromise!: Promise<unknown>
    act(() => {
      replacePromise = result.current.replace({ assistantId: 'assistant-2' })
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-1'
    })
    expect(mocks.dataApiDelete).not.toHaveBeenCalled()

    await act(async () => {
      resolveNextTopic({ id: 'temp-topic-2', messages: [] })
      await replacePromise
    })

    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-2',
      assistantId: 'assistant-2'
    })
    expect(mocks.dataApiDelete).toHaveBeenCalledWith('/temporary/topics/temp-topic-1')
  })

  it('updates a temporary assistant conversation in place', async () => {
    const { result } = renderHook(() => useTemporaryConversation({ type: 'assistant' }))

    mocks.dataApiPost.mockResolvedValueOnce({
      id: 'temp-topic-1',
      messages: []
    })

    await act(async () => {
      await result.current.start({ assistantId: 'assistant-1' })
    })

    mocks.dataApiPatch.mockResolvedValueOnce({
      id: 'temp-topic-1',
      assistantId: 'assistant-2',
      messages: []
    })

    await act(async () => {
      await result.current.updateAssistant('assistant-2')
    })

    expect(mocks.dataApiPatch).toHaveBeenCalledWith('/temporary/topics/temp-topic-1', {
      body: { assistantId: 'assistant-2' }
    })
    expect(mocks.dataApiDelete).not.toHaveBeenCalled()
    expect(result.current.conversation).toMatchObject({
      type: 'assistant',
      topicId: 'temp-topic-1',
      assistantId: 'assistant-2'
    })
  })
})
