/**
 * Owns `agent-session:{id}` topics. Reads state from sessions /
 * agents, persists through `agentSessionMessageService`, single-model
 * only (no @mention fan-out), passes `userMessage` for the inject path.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { sessionService } from '@data/services/SessionService'
import { application } from '@main/core/application'
import { topicNamingService } from '@main/services/TopicNamingService'
import { trace } from '@opentelemetry/api'
import type { Message } from '@shared/data/types/message'

import {
  extractAgentSessionId,
  isAgentSessionTopic,
  parseAgentSessionModel
} from '../../provider/claudeCodeSettingsBuilder'
import { AdapterTracer, TRACER_NAME } from '../../trace'
import { PersistenceListener } from '../listeners/PersistenceListener'
import { AgentMessageBackend } from '../persistence/backends/AgentMessageBackend'
import type { StreamListener } from '../types'
import type { ChatContextProvider, DispatchContext, PreparedDispatch } from './ChatContextProvider'
import type { MainDispatchRequest } from './dispatch'

const rawTracer = trace.getTracer(TRACER_NAME)

export class AgentChatContextProvider implements ChatContextProvider {
  readonly name = 'agent-session'

  canHandle(topicId: string): boolean {
    return isAgentSessionTopic(topicId)
  }

  async prepareDispatch(
    subscriber: StreamListener,
    req: MainDispatchRequest,
    ctx: DispatchContext
  ): Promise<PreparedDispatch> {
    if (req.trigger !== 'submit-message') {
      throw new Error(`Agent sessions only support 'submit-message' (got '${req.trigger}')`)
    }

    const sessionId = extractAgentSessionId(req.topicId)

    const session = await sessionService.getById(sessionId)
    if (!session.agentId) {
      throw new Error(`Cannot dispatch on orphan session ${sessionId} — its agent was deleted`)
    }
    const agentId = session.agentId
    const agent = await agentService.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found for session ${sessionId}: ${agentId}`)
    if (!agent.model) throw new Error(`Agent ${agent.id} has no model configured`)

    // Below we ship ONLY the latest user turn — Claude Code resumes context via its
    // SDK session id (see `lastAgentSessionId` in provider/config.ts). A non-CC
    // agent without server-side state would lose history; reject until a loader exists.
    if (agent.type !== 'claude-code') {
      throw new Error(
        `AgentChatContextProvider only supports 'claude-code' agents (got '${agent.type}'); other types need a history loader before dispatch.`
      )
    }

    const uniqueModelId = parseAgentSessionModel(agent.model)

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    const userMessageId = crypto.randomUUID()
    const userMessageParts = req.userMessageParts ?? [{ type: 'text', text: userText }]
    const createdAt = new Date().toISOString()

    const userMessage: Message = {
      id: userMessageId,
      topicId: req.topicId,
      parentId: null,
      role: 'user',
      data: { parts: userMessageParts },
      searchableText: userText,
      status: 'success',
      siblingsGroupId: 0,
      createdAt,
      updatedAt: createdAt
    }

    if (ctx.hasLiveStream) {
      // Inject path — placeholder + listener already exist on the in-flight execution.
      // Adding new ones would orphan a pending row and clobber the listener mid-stream.
      await agentSessionMessageService.persistUserMessage({
        sessionId,
        agentSessionId: null,
        payload: {
          message: {
            id: userMessageId,
            role: 'user',
            assistantId: agentId,
            topicId: req.topicId,
            createdAt,
            status: 'success',
            data: { parts: userMessageParts }
          },
          blocks: []
        }
      })

      return {
        topicId: req.topicId,
        models: [],
        userMessage,
        listeners: [subscriber],
        isMultiModel: false
      }
    }

    const assistantMessageId = crypto.randomUUID()

    // Root span; AI SDK children inherit its traceId. `AdapterTracer` persists the root.
    const adapterTracer = new AdapterTracer(rawTracer, req.topicId, uniqueModelId)
    const rootSpan = adapterTracer.startSpan('chat.turn', {
      attributes: {
        'cs.topic_id': req.topicId,
        'cs.trigger': req.trigger,
        'cs.model_id': uniqueModelId,
        'cs.role': 'assistant',
        'cs.agent_id': agentId,
        'cs.session_id': sessionId
      }
    })
    const traceId = rootSpan.spanContext().traceId
    application.get('SpanCacheService').setTopicId(traceId, req.topicId)

    // Atomic user + pending-assistant write so `useAgentSessionParts` observes both at once.
    await agentSessionMessageService.persistExchange({
      sessionId,
      agentSessionId: null,
      user: {
        payload: {
          message: {
            id: userMessageId,
            role: 'user',
            assistantId: agentId,
            topicId: req.topicId,
            createdAt,
            status: 'success',
            data: { parts: userMessageParts }
          },
          blocks: []
        }
      },
      assistant: {
        payload: {
          message: {
            id: assistantMessageId,
            role: 'assistant',
            assistantId: agentId,
            topicId: req.topicId,
            createdAt: new Date().toISOString(),
            status: 'pending',
            data: { parts: [] }
          },
          blocks: []
        }
      }
    })

    const agentPersistenceListener = new PersistenceListener({
      topicId: req.topicId,
      modelId: uniqueModelId,
      backend: new AgentMessageBackend({
        sessionId,
        agentId: agentId,
        afterPersist: async (finalMessage) => {
          await topicNamingService.maybeRenameAgentSession(agentId, sessionId, userText, finalMessage)
        }
      })
    })

    return {
      topicId: req.topicId,
      models: [
        {
          modelId: uniqueModelId,
          request: {
            chatId: req.topicId,
            trigger: 'submit-message',
            assistantId: agentId,
            uniqueModelId,
            messages: [{ id: userMessageId, role: 'user', parts: [{ type: 'text', text: userText }] }],
            messageId: assistantMessageId
          },
          rootSpan
        }
      ],
      userMessage,
      listeners: [subscriber, agentPersistenceListener],
      isMultiModel: false
    }
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
