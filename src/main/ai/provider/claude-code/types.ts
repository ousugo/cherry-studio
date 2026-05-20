import type { LanguageModelV3ToolApprovalRequest } from '@ai-sdk/provider'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Message } from '@shared/data/types/message'

export type {
  AgentMcpServerSpec,
  CanUseTool,
  McpServerConfig,
  Options,
  PermissionMode,
  SandboxSettings,
  SdkBeta,
  SdkPluginConfig,
  SpawnedProcess,
  SpawnOptions,
  ThinkingConfig
} from '@anthropic-ai/claude-agent-sdk'

/**
 * Session-level settings for the Claude Code SDK. Derived from the Agent
 * SDK's `Options`; `model` / `abortController` / `prompt` / `outputFormat`
 * are managed by the language model internally.
 */
export type ClaudeCodeSettings = Omit<Options, 'model' | 'abortController' | 'prompt' | 'outputFormat'> & {
  /** Max chars for tool results in client stream. @default 10000 */
  maxToolResultSize?: number
  /**
   * Follow-up messages injected mid-stream — forwarded to the Claude
   * Agent SDK's `query.streamInput()` as `SDKUserMessage`. Backed by
   * `PendingMessageQueue` (which implements AsyncIterable).
   */
  injectedMessageSource?: AsyncIterable<Message>
  /**
   * Per-stream holder for the controller's `enqueue` binding. `canUseTool`
   * calls `emit` to inject a `tool-approval-request` part into the live
   * stream; `dispose` is the session-scoped cleanup fired in `finally`.
   */
  approvalEmitter?: ToolApprovalEmitterHolder
}

export type ToolApprovalEmitterHolder = {
  /** Set at stream start (bound to controller `enqueue`); cleared in `finally`. */
  emit?: (event: LanguageModelV3ToolApprovalRequest) => void
  /** Session-scoped cleanup (e.g. `toolApprovalRegistry.abort(sessionId)`). */
  dispose?: () => void
}

export interface ClaudeCodeProviderSettings {
  /** Injected as `ANTHROPIC_API_KEY` env var to the SDK process. */
  apiKey?: string
  /** Injected as `ANTHROPIC_BASE_URL` env var to the SDK process. */
  baseURL?: string
  defaultSettings?: ClaudeCodeSettings
}
