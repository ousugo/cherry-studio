import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PendingMessageQueue } from '../../../agent/loop/PendingMessageQueue'
import type { StreamListener } from '../../types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAgent: vi.fn(),
  saveMessage: vi.fn(),
  saveMessages: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  spanCacheSetTopicId: vi.fn(),
  runtimeBeginTurn: vi.fn(),
  runtimeInspect: vi.fn()
}))

vi.mock('@data/services/SessionService', () => ({
  sessionService: { getById: mocks.getSession }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    saveMessages: mocks.saveMessages
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentChatContextProvider } = await import('../AgentChatContextProvider')

function makeSubscriber(id = 'wc:1:agent-session:session-1'): StreamListener {
  return {
    id,
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function openReq(overrides: Partial<AiStreamOpenRequest> = {}): AiStreamOpenRequest {
  return {
    topicId: 'agent-session:session-1',
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'hello' }],
    ...overrides
  } as AiStreamOpenRequest
}

describe('AgentChatContextProvider', () => {
  let provider: InstanceType<typeof AgentChatContextProvider>
  let runtimeQueue: PendingMessageQueue
  let runtimeListener: StreamListener

  beforeEach(() => {
    provider = new AgentChatContextProvider()
    runtimeQueue = new PendingMessageQueue()
    runtimeListener = makeSubscriber('agent-runtime:session-1')

    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp' } })
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', type: 'claude-code', model: 'anthropic::claude-sonnet' })
    mocks.saveMessage.mockResolvedValue(undefined)
    mocks.saveMessages.mockResolvedValue(undefined)
    mocks.runtimeBeginTurn.mockReturnValue({
      pendingMessages: runtimeQueue,
      listener: runtimeListener,
      turnId: 'turn-1'
    })
    mocks.runtimeInspect.mockReturnValue({ sdkSessionId: 'sdk-session-1' })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'SpanCacheService') return { setTopicId: mocks.spanCacheSetTopicId }
      if (name === 'AgentSessionRuntimeService') {
        return { beginTurn: mocks.runtimeBeginTurn, inspect: mocks.runtimeInspect }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('prepares fresh agent-session dispatch with runtime queue and terminal listener', async () => {
    const subscriber = makeSubscriber()

    const prepared = await provider.prepareDispatch(subscriber, openReq(), { hasLiveStream: false })

    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledOnce()
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      topicId: 'agent-session:session-1',
      agentId: 'agent-1',
      modelId: 'anthropic::claude-sonnet',
      assistantMessageId: prepared.models[0].request.messageId,
      userMessage: prepared.userMessage
    })

    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet')
    expect(prepared.models[0].request.runtime).toEqual({
      kind: 'agent-session',
      sessionId: 'session-1',
      turnId: 'turn-1'
    })
    expect(prepared.models[0].request.pendingMessages).toBe(runtimeQueue)
    expect(prepared.listeners).toEqual([subscriber, expect.any(Object), runtimeListener])
  })

  it('prepares live inject without creating a new runtime turn or assistant placeholder', async () => {
    const subscriber = makeSubscriber()

    const prepared = await provider.prepareDispatch(subscriber, openReq(), { hasLiveStream: true })

    expect(mocks.saveMessage).toHaveBeenCalledOnce()
    expect(mocks.saveMessages).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
    expect(prepared.models).toEqual([])
    expect(prepared.userMessage?.role).toBe('user')
    expect(prepared.listeners).toEqual([subscriber])
  })

  it('rejects invalid workspaces before persisting messages or starting runtime', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { path: '/path/that/does/not/exist' }
    })

    await expect(provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })).rejects.toThrow(
      'AgentSessionWorkspaceError:'
    )

    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.saveMessages).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
  })
})
