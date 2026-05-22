import type { AgentTool } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { Message } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

export interface AgentRuntimeConnectInput {
  sessionId: string
  agentId: string
  modelId: UniqueModelId
  resumeToken?: string
}

export interface AgentRuntimeUserInput {
  message: Message
}

export type AgentRuntimeEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'resume-token'; token: string }
  | { type: 'turn-complete' }
  | { type: 'error'; error: unknown }

export interface AgentRuntimeConnection {
  readonly events: AsyncIterable<AgentRuntimeEvent>
  send(input: AgentRuntimeUserInput): void | Promise<void>
  interrupt?(): Promise<void>
  close(): void | Promise<void>
}

export interface AgentRuntimeDriver {
  readonly type: string
  /**
   * One-time driver initialization (binary extraction, credential warmup, …).
   * Called by `AgentSessionRuntimeService.onInit` for every registered driver.
   * Optional: drivers without async startup work can omit it.
   */
  init?(): void | Promise<void>
  /**
   * Per-driver session prerequisite check: throws if the session can't be
   * served (e.g. workspace path missing, credentials absent). Hosts call
   * this before `connect()` instead of hard-coding driver-specific guards.
   */
  validateSession(session: AgentSessionEntity): void | Promise<void>
  /** Enumerate the tools this driver exposes for the given MCP server set. */
  listAvailableTools(mcpIds: string[]): Promise<AgentTool[]>
  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection>
}
