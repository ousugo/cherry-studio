import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

// Stub model resolution + tracing so the test drives the REAL DB history path
// (`createUserMessageWithPlaceholders` → `getPathToNode`) without provider/model
// resolution machinery. The history is what we assert on.
const MODEL_ID = createUniqueModelId('openai', 'gpt-4o')
vi.mock('../modelResolution', () => ({
  resolveAssistantModelId: vi.fn(async () => ({ assistantId: undefined, defaultModelId: MODEL_ID })),
  resolveModels: vi.fn(async () => [{ id: MODEL_ID, name: 'GPT-4o', providerId: 'openai', apiModelId: 'gpt-4o' }]),
  resolvePersistentSiblingsGroupId: vi.fn(async () => 1)
}))

vi.mock('../../observability', () => ({
  startAiTurnTrace: vi.fn(() => ({ rootSpan: { end: vi.fn() }, traceId: 'trace-1' }))
}))

const { PersistentChatContextProvider } = await import('../PersistentChatContextProvider')

function makeSubscriber(): StreamListener {
  return { id: 'wc:1', onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

/** Flatten a history message to `{ role, text }` for order-sensitive assertions. */
function flatten(messages: { role: string; parts: Array<{ type: string; text?: string }> }[]) {
  return messages.map((m) => ({
    role: m.role,
    text: m.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  }))
}

describe('PersistentChatContextProvider — steer-restart history (#B4)', () => {
  const dbh = setupTestDatabase()
  const provider = new PersistentChatContextProvider()

  // The text the model was mid-producing when the user steered; persisted on the
  // assistant row as `paused` by `abortAndAwait` before the prompt is rebuilt.
  const PARTIAL = 'partial answer so far'

  beforeEach(async () => {
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values({ providerId: 'openai', name: 'OpenAI', orderKey: providerKey })
    await dbh.db.insert(userModelTable).values({
      id: MODEL_ID,
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'GPT-4o',
      isEnabled: true,
      isHidden: false,
      orderKey: modelKey
    })

    await dbh.db.insert(topicTable).values({ id: 'topic-1', activeNodeId: 'a1', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values([
      {
        id: 'u1',
        parentId: null,
        topicId: 'topic-1',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'first question' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: 'a1',
        parentId: 'u1',
        topicId: 'topic-1',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: PARTIAL }] },
        status: 'paused',
        siblingsGroupId: 1,
        modelId: MODEL_ID,
        createdAt: 200,
        updatedAt: 200
      }
    ])
  })

  it('rebuilds a prompt that carries the paused partial when the new turn anchors on the paused row', async () => {
    // Steering: renderer's `activeNodeId` (the streaming/paused assistant row) is sent as
    // `parentAnchorId`, so the new user message is parented on the paused row.
    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-1',
      parentAnchorId: 'a1',
      userMessageParts: [{ type: 'text', text: 'actually, change direction' }]
    } as AiStreamOpenRequest)

    const history = prepared.models[0].request.messages
    expect(history).toBeDefined()
    expect(flatten(history!)).toEqual([
      { role: 'user', text: 'first question' },
      // The paused partial survives into the rebuilt prompt — this is the B4 efficacy guarantee.
      { role: 'assistant', text: PARTIAL },
      { role: 'user', text: 'actually, change direction' }
    ])
  })

  it('drops the paused partial when the new turn does not anchor on it (precondition is necessary)', async () => {
    // Counter-case: anchoring on the prior user message (not the paused assistant row) rebuilds
    // a prompt WITHOUT the partial — proving the efficacy hinges on `parentAnchorId` = paused row.
    const prepared = await provider.prepareDispatch(makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-1',
      parentAnchorId: 'u1',
      userMessageParts: [{ type: 'text', text: 'retry from before' }]
    } as AiStreamOpenRequest)

    expect(flatten(prepared.models[0].request.messages!)).toEqual([
      { role: 'user', text: 'first question' },
      { role: 'user', text: 'retry from before' }
    ])
  })
})
