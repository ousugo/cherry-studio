import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildRequest: vi.fn(),
  applicationGet: vi.fn(),
  consumeWarmQuery: vi.fn(),
  createClaudeQuery: vi.fn(),
  adapterInstances: [] as any[]
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.createClaudeQuery
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeQueryRequestForAgentSession: mocks.buildRequest
}))

vi.mock('../streamAdapter', () => ({
  ClaudeCodeStreamAdapter: class {
    readonly finalizeOpenParts = vi.fn()

    constructor(private readonly options: any) {
      mocks.adapterInstances.push(this)
    }

    handleMessage(message: any) {
      if (message.type === 'system' && message.subtype === 'init') {
        this.options.onSessionId(message.session_id)
        this.options.sink.enqueue({ type: 'message-metadata', messageMetadata: { modelId: 'sonnet-sdk' } })
        return { type: 'continue' }
      }
      if (message.type === 'stream_event') {
        this.options.sink.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
        return { type: 'continue' }
      }
      if (message.type === 'result') {
        this.options.onSessionId(message.session_id)
        this.options.sink.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' } })
        if (message.subtype !== 'success') throw new Error('runtime failed')
        return { type: 'result', sessionId: message.session_id, message }
      }
      return { type: 'continue' }
    }
  }
}))

const { ClaudeCodeRuntimeDriver } = await import('../ClaudeCodeRuntimeDriver')

function createAsyncQueue<T>() {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []
  let closed = false

  return {
    push(item: T) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value: item, done: false })
      else items.push(item)
    },
    close() {
      closed = true
      while (waiters.length > 0) waiters.shift()?.({ value: undefined as T, done: true })
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const item = items.shift()
            if (item) return Promise.resolve({ value: item, done: false })
            if (closed) return Promise.resolve({ value: undefined as T, done: true })
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
          }
        }
      }
    }
  }
}

function userMessage() {
  return {
    id: 'user-1',
    topicId: 'agent-session:session-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    createdAt: '',
    updatedAt: ''
  } as any
}

describe('ClaudeCodeRuntimeDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.adapterInstances.length = 0
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeWarmQueryManager') return { consume: mocks.consumeWarmQuery }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.consumeWarmQuery.mockResolvedValue(undefined)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: {},
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
  })

  it('connects with an opaque resume token and sends user input into the SDK queue', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)

    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any,
      resumeToken: 'resume-1'
    })

    expect(mocks.buildRequest).toHaveBeenCalledWith('session-1', 'resume-1')
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    connection.send({ message: userMessage() })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        session_id: 'resume-1',
        message: { role: 'user', content: 'hello' }
      },
      done: false
    })
    connection.close()
  })

  it('emits resume token, chunks, and turn-complete events', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({ type: 'system', subtype: 'init', session_id: 'resume-init' })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'resume-token', token: 'resume-init' }
    })

    connection.send({ message: userMessage() })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'message-metadata', messageMetadata: { modelId: 'sonnet-sdk' } } }
    })

    queryQueue.push({ type: 'stream_event', event: {}, session_id: 'resume-init' })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'text-delta', delta: 'hello' } }
    })

    queryQueue.push({ type: 'result', subtype: 'success', session_id: 'resume-result' })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'resume-token', token: 'resume-result' }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'finish' } }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'turn-complete' }
    })
    connection.close()
  })

  it('interrupts and finalizes the active adapter', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    connection.send({ message: userMessage() })
    await connection.interrupt?.()

    expect(query.interrupt).toHaveBeenCalled()
    expect(mocks.adapterInstances[0].finalizeOpenParts).toHaveBeenCalled()
    connection.close()
  })

  it('binds tool approval requests into the active turn stream', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    const dispose = vi.fn()
    const approvalEmitter: any = { dispose }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { approvalEmitter },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    void connection.send({ message: userMessage() })
    approvalEmitter.emit({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as any)

    await expect(events.next()).resolves.toMatchObject({
      value: {
        type: 'chunk',
        chunk: {
          type: 'tool-approval-request',
          approvalId: 'approval-1',
          toolCallId: 'tool-1'
        }
      }
    })
    void connection.close()
    expect(dispose).toHaveBeenCalled()
  })
})
