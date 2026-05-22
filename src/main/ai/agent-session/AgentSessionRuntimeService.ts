import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { topicNamingService } from '@main/services/TopicNamingService'
import type { CherryUIMessage, Message } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'
import { v7 as uuidv7 } from 'uuid'
import * as z from 'zod'

import { PendingMessageQueue } from '../ai-sdk/loop/PendingMessageQueue'
import { PersistenceListener } from '../stream-manager/listeners/PersistenceListener'
import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../stream-manager/types'
import { AgentSessionMessageBackend } from './persistence/AgentSessionMessageBackend'
import { type AgentRuntimeConnection, agentRuntimeDriverRegistry, type AgentRuntimeEvent } from './runtime'
import { type DispatchDecision, toolApprovalRegistry } from './runtime/claude-code/ToolApprovalRegistry'

const ListToolsArgsSchema = z.strictObject({
  type: z.enum(['claude-code']).default('claude-code'),
  mcps: z.array(z.string()).default([])
})

const logger = loggerService.withContext('AgentSessionRuntimeService')
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000

export type AgentSessionRuntimeStatus = 'active' | 'idle'
export type AgentSessionRuntimeTerminalStatus = 'success' | 'paused' | 'error'

export interface BeginAgentSessionTurnInput {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  assistantMessageId?: string
  userMessage?: Message
}

export interface AgentSessionRuntimeHandle {
  pendingMessages: PendingMessageQueue
  listeners: StreamListener[]
  turnId: string
}

export interface OpenAgentSessionTurnStreamInput {
  sessionId: string
  turnId: string
  signal: AbortSignal
}

export interface AgentSessionRuntimeSnapshot {
  sessionId: string
  topicId?: string
  assistantMessageId?: string
  status: AgentSessionRuntimeStatus
  pendingMessageCount: number
  lastTerminalStatus?: AgentSessionRuntimeTerminalStatus
  resumeToken?: string
  activeToolCount: number
  interruptRequested: boolean
}

type AgentSessionTurn = {
  turnId: string
  assistantMessageId?: string
  userMessage: Message
  modelId: UniqueModelId
  admitted: boolean
  terminalStatus?: AgentSessionRuntimeTerminalStatus
  controller?: ReadableStreamDefaultController<UIMessageChunk>
  activeToolIds: Set<string>
  interruptRequested: boolean
}

type AgentSessionRuntimeEntry = {
  sessionId: string
  topicId: string
  agentId: string
  agentType: string
  modelId: UniqueModelId
  status: AgentSessionRuntimeStatus
  pendingMessages: PendingMessageQueue
  connection?: AgentRuntimeConnection
  connectionLoop?: Promise<void>
  currentTurn?: AgentSessionTurn
  lastResumeToken?: string
  lastTerminalStatus?: AgentSessionRuntimeTerminalStatus
  idleTimer?: ReturnType<typeof setTimeout>
  startingNextTurn?: boolean
}

class AgentSessionRuntimeTerminalListener implements StreamListener {
  readonly id: string

  constructor(
    private readonly service: AgentSessionRuntimeService,
    private readonly sessionId: string
  ) {
    this.id = `agent-runtime:${sessionId}`
  }

  onChunk(): void {}

  onDone(result: StreamDoneResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'success')
  }

  onPaused(result: StreamPausedResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'paused')
  }

  onError(result: StreamErrorResult): void {
    if (result.isTopicDone === false) return
    this.service.markTurnTerminal(this.sessionId, 'error')
  }

  isAlive(): boolean {
    return true
  }
}

@Injectable('AgentSessionRuntimeService')
@ServicePhase(Phase.WhenReady)
export class AgentSessionRuntimeService extends BaseService {
  private readonly entries = new Map<string, AgentSessionRuntimeEntry>()

  protected async onInit(): Promise<void> {
    this.ipcHandle(IpcChannel.Agent_ListTools, async (_event, args: unknown) => {
      const parsed = ListToolsArgsSchema.parse(args ?? {})
      const driver = agentRuntimeDriverRegistry.get(parsed.type)
      if (!driver) {
        throw new Error(`Unsupported agent runtime type: ${parsed.type}`)
      }
      return driver.listAvailableTools(parsed.mcps)
    })
  }

  beginTurn(input: BeginAgentSessionTurnInput): AgentSessionRuntimeHandle {
    const pendingMessages = new PendingMessageQueue((message) => this.enqueueUserMessage(input.sessionId, message))
    const turnId = crypto.randomUUID()
    const userMessage = input.userMessage ?? createSyntheticUserMessage(input.topicId)
    const existing = this.entries.get(input.sessionId)
    const turn: AgentSessionTurn = {
      turnId,
      assistantMessageId: input.assistantMessageId,
      userMessage,
      modelId: input.modelId,
      admitted: false,
      activeToolIds: new Set(),
      interruptRequested: false
    }

    if (existing?.status === 'idle') {
      this.clearIdleTimer(existing)
      existing.pendingMessages.close()
      existing.topicId = input.topicId
      existing.agentId = input.agentId
      existing.agentType = input.agentType
      existing.modelId = input.modelId
      existing.status = 'active'
      existing.pendingMessages = pendingMessages
      existing.currentTurn = turn

      return {
        pendingMessages,
        listeners: [
          this.createPersistenceListener(existing, userMessage),
          new AgentSessionRuntimeTerminalListener(this, input.sessionId)
        ],
        turnId
      }
    }

    if (existing) this.closeSession(input.sessionId)

    const entry: AgentSessionRuntimeEntry = {
      sessionId: input.sessionId,
      topicId: input.topicId,
      agentId: input.agentId,
      agentType: input.agentType,
      modelId: input.modelId,
      status: 'active',
      pendingMessages,
      currentTurn: turn
    }
    this.entries.set(input.sessionId, entry)

    return {
      pendingMessages,
      listeners: [
        this.createPersistenceListener(entry, userMessage),
        new AgentSessionRuntimeTerminalListener(this, input.sessionId)
      ],
      turnId
    }
  }

  openTurnStream(input: OpenAgentSessionTurnStreamInput): ReadableStream<UIMessageChunk> {
    const entry = this.entries.get(input.sessionId)
    const turn = entry?.currentTurn
    if (!entry || !turn || turn.turnId !== input.turnId) {
      throw new Error(`No active agent runtime turn ${input.turnId} for session ${input.sessionId}`)
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          this.clearIdleTimer(entry)
          turn.controller = controller

          const onAbort = () => this.closeCurrentTurn(entry, 'paused')
          if (input.signal.aborted) onAbort()
          else input.signal.addEventListener('abort', onAbort, { once: true })

          controller.enqueue({ type: 'stream-start', warnings: [] } as unknown as UIMessageChunk)
          await this.ensureConnection(entry)
          await this.admitTurn(entry, turn)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel: () => {
        this.closeCurrentTurn(entry, 'paused')
      }
    })
  }

  enqueueUserMessage(sessionId: string, _message: Message): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    entry.status = 'active'
    this.clearIdleTimer(entry)

    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) {
      this.scheduleNextTurn(entry)
      return
    }

    if (turn.activeToolIds.size > 0) return

    queueMicrotask(() => {
      const latest = this.entries.get(sessionId)
      if (!latest?.currentTurn || latest.currentTurn.terminalStatus) {
        if (latest) this.scheduleNextTurn(latest)
        return
      }
      this.requestInterruptWhenSafe(latest)
    })
  }

  markTurnTerminal(sessionId: string, status: AgentSessionRuntimeTerminalStatus): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return

    entry.status = 'idle'
    entry.lastTerminalStatus = status
    if (entry.currentTurn) entry.currentTurn.terminalStatus = status

    if (entry.pendingMessages.hasPending()) {
      this.scheduleNextTurn(entry)
    } else {
      this.refreshIdleTimer(entry)
    }
  }

  closeSession(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.entries.delete(sessionId)
    this.closeEntry(entry)
  }

  inspect(sessionId: string): AgentSessionRuntimeSnapshot | undefined {
    const entry = this.entries.get(sessionId)
    if (!entry) return undefined
    const turn = entry.currentTurn

    return {
      sessionId: entry.sessionId,
      topicId: entry.topicId,
      assistantMessageId: turn?.assistantMessageId,
      status: entry.status,
      pendingMessageCount: entry.pendingMessages.list().length,
      lastTerminalStatus: entry.lastTerminalStatus,
      resumeToken: entry.lastResumeToken,
      activeToolCount: turn?.activeToolIds.size ?? 0,
      interruptRequested: turn?.interruptRequested ?? false
    }
  }

  /**
   * Resolve a Claude `canUseTool` approval that was registered against the live
   * driver session. Returns `false` if no live entry matches — the caller
   * falls back to MCP/DB path.
   */
  respondToolApproval(approvalId: string, decision: DispatchDecision): boolean {
    return toolApprovalRegistry.dispatch(approvalId, decision)
  }

  protected onStop(): void {
    this.closeAll()
    toolApprovalRegistry.clear('agent-session-runtime-stop')
  }

  protected onDestroy(): void {
    this.closeAll()
    toolApprovalRegistry.clear('agent-session-runtime-destroy')
  }

  private async ensureConnection(entry: AgentSessionRuntimeEntry): Promise<void> {
    if (entry.connection) return

    const driver = agentRuntimeDriverRegistry.get(entry.agentType)
    if (!driver) throw new Error(`Unsupported agent runtime type: ${entry.agentType}`)

    const connection = await driver.connect({
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      modelId: entry.modelId,
      resumeToken: entry.lastResumeToken
    })
    entry.connection = connection
    entry.connectionLoop = this.runConnectionLoop(entry, connection).finally(() => {
      if (entry.connection === connection) entry.connection = undefined
      if (entry.connectionLoop) entry.connectionLoop = undefined
    })
  }

  private async runConnectionLoop(entry: AgentSessionRuntimeEntry, connection: AgentRuntimeConnection): Promise<void> {
    try {
      for await (const event of connection.events) {
        this.handleRuntimeEvent(entry, event)
      }
    } catch (error) {
      this.handleRuntimeError(entry, error)
    }
  }

  private handleRuntimeEvent(entry: AgentSessionRuntimeEntry, event: AgentRuntimeEvent): void {
    switch (event.type) {
      case 'resume-token':
        entry.lastResumeToken = event.token
        break
      case 'chunk': {
        const turn = entry.currentTurn
        if (turn?.controller && !turn.terminalStatus) this.enqueueTurnChunk(entry, turn, event.chunk)
        break
      }
      case 'turn-complete':
        this.closeCurrentTurn(entry, 'success')
        break
      case 'error':
        this.handleRuntimeError(entry, event.error)
        break
    }
  }

  private handleRuntimeError(entry: AgentSessionRuntimeEntry, error: unknown): void {
    const turn = entry.currentTurn
    if (turn?.controller && !turn.terminalStatus) {
      turn.controller.error(error)
    } else {
      logger.warn('Agent runtime connection ended without an active turn', { sessionId: entry.sessionId, error })
    }
  }

  private async admitTurn(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn): Promise<void> {
    if (turn.admitted) return
    turn.admitted = true
    entry.status = 'active'
    await entry.connection?.send({ message: turn.userMessage })
    if (entry.pendingMessages.hasPending()) {
      queueMicrotask(() => this.requestInterruptWhenSafe(entry))
    }
  }

  private enqueueTurnChunk(entry: AgentSessionRuntimeEntry, turn: AgentSessionTurn, chunk: UIMessageChunk): void {
    const toolChunk = chunk as { type?: string; toolCallId?: string }
    if (toolChunk.type === 'tool-call' && toolChunk.toolCallId) {
      turn.activeToolIds.add(toolChunk.toolCallId)
    } else if (toolChunk.type === 'tool-result' && toolChunk.toolCallId) {
      turn.activeToolIds.delete(toolChunk.toolCallId)
    }

    turn.controller?.enqueue(chunk)

    if (turn.activeToolIds.size === 0 && entry.pendingMessages.hasPending()) this.requestInterruptWhenSafe(entry)
  }

  private requestInterruptWhenSafe(entry: AgentSessionRuntimeEntry): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus || !turn.admitted || turn.interruptRequested) return
    if (turn.activeToolIds.size > 0) return
    turn.interruptRequested = true
    this.interruptCurrentTurn(entry)
  }

  private interruptCurrentTurn(entry: AgentSessionRuntimeEntry): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) return
    void entry.connection?.interrupt?.().catch((error) => {
      logger.warn('Agent runtime interrupt failed', { sessionId: entry.sessionId, error })
    })
    application.get('AiStreamManager').pauseRuntimeTurn(entry.topicId, 'agent-runtime-interrupt')
  }

  private closeCurrentTurn(entry: AgentSessionRuntimeEntry, status: AgentSessionRuntimeTerminalStatus): void {
    const turn = entry.currentTurn
    if (!turn || turn.terminalStatus) return
    turn.terminalStatus = status
    try {
      turn.controller?.close()
    } catch {
      // Already closed by the stream reader.
    }
    turn.controller = undefined
    turn.activeToolIds.clear()
  }

  private scheduleNextTurn(entry: AgentSessionRuntimeEntry): void {
    if (entry.startingNextTurn) return
    entry.startingNextTurn = true
    queueMicrotask(() => {
      entry.startingNextTurn = false
      void this.startNextTurn(entry).catch((error) => {
        logger.error('Failed to start next agent runtime turn', { sessionId: entry.sessionId, error })
      })
    })
  }

  private async startNextTurn(entry: AgentSessionRuntimeEntry): Promise<void> {
    const nextMessage = entry.pendingMessages.list()[0]
    if (!nextMessage) {
      this.refreshIdleTimer(entry)
      return
    }
    entry.pendingMessages.remove(nextMessage.id)

    const assistantMessage = await agentSessionMessageService.saveMessage({
      sessionId: entry.sessionId,
      message: {
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: entry.modelId
      }
    })
    const assistantMessageId = assistantMessage.id

    const turnId = crypto.randomUUID()
    entry.currentTurn = {
      turnId,
      assistantMessageId,
      userMessage: nextMessage,
      modelId: entry.modelId,
      admitted: false,
      activeToolIds: new Set(),
      interruptRequested: false
    }

    application.get('AiStreamManager').startRuntimeTurn({
      topicId: entry.topicId,
      modelId: entry.modelId,
      request: {
        chatId: entry.topicId,
        trigger: 'submit-message',
        messageId: assistantMessageId,
        messages: createRuntimeSeedMessages(nextMessage, assistantMessageId),
        runtime: { kind: 'agent-session', sessionId: entry.sessionId, turnId },
        pendingMessages: entry.pendingMessages
      },
      listeners: [
        this.createPersistenceListener(entry, nextMessage),
        new AgentSessionRuntimeTerminalListener(this, entry.sessionId)
      ]
    })
  }

  private createPersistenceListener(entry: AgentSessionRuntimeEntry, userMessage: Message): StreamListener {
    const userText = extractMessageText(userMessage)
    return new PersistenceListener({
      topicId: entry.topicId,
      modelId: entry.modelId,
      backend: new AgentSessionMessageBackend({
        sessionId: entry.sessionId,
        modelId: entry.modelId,
        runtimeResumeToken: () => entry.lastResumeToken,
        afterPersist: async (finalMessage) => {
          await topicNamingService.maybeRenameAgentSession(entry.agentId, entry.sessionId, userText, finalMessage)
        }
      })
    })
  }

  private refreshIdleTimer(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    entry.idleTimer = setTimeout(() => {
      this.closeSession(entry.sessionId)
      if (entry.lastResumeToken) {
        void application.get('ClaudeCodeWarmupService').prewarmAgentSession(entry.sessionId)
      }
    }, DEFAULT_IDLE_TTL_MS)
    entry.idleTimer.unref?.()
  }

  private clearIdleTimer(entry: AgentSessionRuntimeEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private closeAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.closeSession(sessionId)
    }
  }

  private closeEntry(entry: AgentSessionRuntimeEntry): void {
    this.clearIdleTimer(entry)
    this.closeCurrentTurn(entry, 'paused')
    entry.pendingMessages.close()

    const connection = entry.connection
    entry.connection = undefined
    entry.connectionLoop = undefined
    entry.currentTurn = undefined
    entry.startingNextTurn = false

    void connection?.close()
  }
}

function createRuntimeSeedMessages(userMessage: Message, assistantMessageId: string): CherryUIMessage[] {
  return [
    {
      id: userMessage.id,
      role: 'user',
      parts: userMessage.data?.parts ?? []
    },
    {
      id: assistantMessageId,
      role: 'assistant',
      parts: []
    }
  ] as CherryUIMessage[]
}

function createSyntheticUserMessage(topicId: string): Message {
  const now = new Date().toISOString()
  return {
    id: uuidv7(),
    topicId,
    parentId: null,
    role: 'user',
    data: { parts: [] },
    status: 'success',
    searchableText: '',
    siblingsGroupId: 0,
    createdAt: now,
    updatedAt: now
  } as Message
}

function extractMessageText(message: Message): string {
  return (
    message.data?.parts
      ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join('\n') ?? ''
  )
}
