import {
  type Query,
  query as createClaudeQuery,
  type SDKSystemMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { application } from '@main/core/application'
import type { Message } from '@shared/data/types/message'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeDriver,
  AgentRuntimeEvent,
  AgentRuntimeUserInput
} from '../types'
import { buildClaudeCodeQueryRequestForAgentSession } from './agentSessionWarmup'
import { ClaudeCodeStreamAdapter } from './streamAdapter'

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}

class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly messages: SDKUserMessage[] = []
  private waitResolve?: (value: IteratorResult<SDKUserMessage>) => void
  private closed = false

  push(message: SDKUserMessage): void {
    if (this.closed) return
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: message, done: false })
      return
    }
    this.messages.push(message)
  }

  close(): void {
    this.closed = true
    if (this.waitResolve) {
      const resolve = this.waitResolve
      this.waitResolve = undefined
      resolve({ value: undefined as unknown as SDKUserMessage, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.messages.shift()
        if (next) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true })
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waitResolve = resolve
        })
      }
    }
  }
}

class ClaudeCodeRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly sdkInputQueue = new SdkInputQueue()
  private readonly abortController = new AbortController()
  private query?: Query
  private adapter?: ClaudeCodeStreamAdapter
  private adapterModelId?: string
  private pendingInitMessage?: SDKSystemMessage
  private resumeToken?: string

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    const request = await buildClaudeCodeQueryRequestForAgentSession(this.input.sessionId, this.resumeToken)
    if (!request) {
      throw new Error(`Unable to build Claude Code query options for agent session ${this.input.sessionId}`)
    }

    const options = {
      ...request.options,
      abortController: this.abortController
    }
    const warmManager = application.get('ClaudeCodeWarmQueryManager')
    const warmQuery = await warmManager.consume({
      key: request.key,
      options,
      initializeTimeoutMs: request.initializeTimeoutMs
    })

    this.query = warmQuery
      ? warmQuery.query(this.sdkInputQueue)
      : createClaudeQuery({ prompt: this.sdkInputQueue, options })
    this.adapterModelId = request.sdkModelId
    void this.runQueryLoop()
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    this.adapter = this.createAdapter(this.adapterModelId ?? this.input.modelId)

    if (this.pendingInitMessage) {
      this.adapter.handleMessage(this.pendingInitMessage)
      this.pendingInitMessage = undefined
    }

    this.sdkInputQueue.push(toSdkUserMessage(input.message, this.resumeToken))
  }

  async interrupt(): Promise<void> {
    this.adapter?.finalizeOpenParts()
    await this.query?.interrupt()
  }

  close(): void {
    this.sdkInputQueue.close()
    this.abortController.abort('agent-runtime-closed')
    this.query?.close()
    this.eventQueue.close()
  }

  private async runQueryLoop(): Promise<void> {
    try {
      for await (const message of this.query!) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.updateResumeToken(message.session_id)
          if (!this.adapter) {
            this.pendingInitMessage = message
            continue
          }
        }

        if (!this.adapter) {
          if (message.type === 'result') this.updateResumeToken(message.session_id)
          continue
        }

        const result = this.adapter.handleMessage(message)
        if (result.type === 'result') {
          this.updateResumeToken(result.sessionId)
          this.adapter = undefined
          this.eventQueue.push({ type: 'turn-complete' })
        }
      }
    } catch (error) {
      this.adapter = undefined
      this.eventQueue.push({ type: 'error', error })
    } finally {
      this.query = undefined
      this.eventQueue.close()
    }
  }

  private createAdapter(modelId: string): ClaudeCodeStreamAdapter {
    return new ClaudeCodeStreamAdapter({
      modelId,
      streamOptions: {} as never,
      sink: {
        enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk })
      },
      onSessionId: (resumeToken) => this.updateResumeToken(resumeToken)
    })
  }

  private updateResumeToken(resumeToken: string): void {
    if (resumeToken === this.resumeToken) return
    this.resumeToken = resumeToken
    this.eventQueue.push({ type: 'resume-token', token: resumeToken })
  }
}

function toSdkUserMessage(message: Message, resumeToken?: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: extractMessageText(message) },
    parent_tool_use_id: null,
    session_id: resumeToken ?? ''
  }
}

function extractMessageText(message: Message): string {
  return (
    message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}

export class ClaudeCodeRuntimeDriver implements AgentRuntimeDriver {
  readonly type = 'claude-code'

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new ClaudeCodeRuntimeConnection(input).start()
  }
}
