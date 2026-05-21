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
  connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection>
}
