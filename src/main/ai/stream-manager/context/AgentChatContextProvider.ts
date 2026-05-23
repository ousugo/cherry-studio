/**
 * Owns `agent-session:{id}` topics. Reads state from sessions /
 * agents, persists through `agentSessionMessageService`, single-model
 * only (no @mention fan-out), passes `userMessage` for the inject path.
 */

import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { sessionService } from '@data/services/SessionService'
import { application } from '@main/core/application'
import { trace } from '@opentelemetry/api'
import type { Message } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import { v7 as uuidv7 } from 'uuid'

import { agentRuntimeDriverRegistry } from '../../agent-session/runtime'
import { extractAgentSessionId, isAgentSessionTopic } from '../../agent-session/topic'
import { AdapterTracer, TRACER_NAME } from '../../trace'
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

    const driver = agentRuntimeDriverRegistry.get(agent.type)
    if (!driver) {
      throw new Error(`Unsupported agent runtime type: ${agent.type}`)
    }
    await driver.validateSession(session)

    const uniqueModelId = agent.model

    const userText =
      req.userMessageParts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') || ''

    const userMessageId = uuidv7()
    const userMessageParts = req.userMessageParts ?? [{ type: 'text', text: userText }]
    const createdAt = new Date().toISOString()

    const userMessage: Message = {
      id: userMessageId,
      topicId: req.topicId,
      parentId: null,
      role: 'user',
      data: { parts: userMessageParts },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      createdAt,
      updatedAt: createdAt
    }

    if (ctx.hasLiveStream) {
      // Inject path — placeholder + listener already exist on the in-flight execution.
      // Adding new ones would orphan a pending row and clobber the listener mid-stream.
      await agentSessionMessageService.saveMessage({
        sessionId,
        message: {
          id: userMessageId,
          role: 'user',
          status: 'success',
          data: { parts: userMessageParts }
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

    const assistantMessageId = uuidv7()

    // Root span; AI SDK children inherit its traceId. `AdapterTracer` persists the root.
    const adapterTracer = new AdapterTracer(rawTracer, req.topicId, parseUniqueModelId(uniqueModelId).modelId)
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
    await agentSessionMessageService.saveMessages({
      sessionId,
      messages: [
        {
          id: userMessageId,
          role: 'user',
          status: 'success',
          data: { parts: userMessageParts }
        },
        {
          id: assistantMessageId,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: uniqueModelId,
          traceId
        }
      ]
    })

    const runtime = application.get('AgentSessionRuntimeService').beginTurn({
      sessionId,
      topicId: req.topicId,
      agentId,
      agentType: agent.type,
      modelId: uniqueModelId,
      assistantMessageId,
      userMessage
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
            messages: [
              { id: userMessageId, role: 'user', parts: userMessageParts },
              { id: assistantMessageId, role: 'assistant', parts: [] }
            ],
            messageId: assistantMessageId,
            runtime: { kind: 'agent-session', sessionId, turnId: runtime.turnId },
            pendingMessages: runtime.pendingMessages
          },
          rootSpan
        }
      ],
      userMessage,
      listeners: [subscriber, ...runtime.listeners],
      isMultiModel: false
    }
  }
}

export const agentChatContextProvider = new AgentChatContextProvider()
