import { application } from '@main/core/application'
import type { CherryMessagePart } from '@shared/data/types/message'

import { agentChatContextProvider } from '../../stream-manager/context/AgentChatContextProvider'
import type { StreamListener } from '../../stream-manager/types'
import { buildAgentSessionTopicId } from '../topic'

/**
 * Start (or inject into) an agent-session stream from a non-renderer caller.
 *
 * Encapsulates the user/assistant persistence + driver turn-begin done by
 * `AgentChatContextProvider`, so schedulers, channel inbound handlers, and
 * other backend triggers go through the same path as the renderer instead
 * of hand-rolling a `manager.send` call.
 *
 * The first listener is treated as the primary subscriber (gets the
 * `runtime.listeners` augmentation from the context provider); any
 * additional listeners are appended verbatim.
 */
export async function startAgentSessionRun(input: {
  sessionId: string
  userParts: CherryMessagePart[]
  listeners: StreamListener[]
}): Promise<void> {
  if (input.listeners.length === 0) {
    throw new Error('startAgentSessionRun requires at least one listener')
  }
  const [primary, ...extras] = input.listeners

  const topicId = buildAgentSessionTopicId(input.sessionId)
  const manager = application.get('AiStreamManager')

  const prepared = await agentChatContextProvider.prepareDispatch(
    primary,
    { trigger: 'submit-message', topicId, userMessageParts: input.userParts },
    { hasLiveStream: manager.hasLiveStream(topicId) }
  )

  manager.send({
    topicId: prepared.topicId,
    models: prepared.models,
    listeners: [...prepared.listeners, ...extras],
    userMessage: prepared.userMessage,
    siblingsGroupId: prepared.siblingsGroupId,
    lifecycle: prepared.lifecycle
  })
}
