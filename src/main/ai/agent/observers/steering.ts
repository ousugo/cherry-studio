/**
 * Drains `pendingMessages` between steps so injected messages fold into
 * the current turn. No-op for Claude Code — that provider consumes the
 * queue directly via `injectedMessageSource`.
 */

import type { UIMessage } from 'ai'
import { convertToModelMessages } from 'ai'

import type { Agent } from '../Agent'
import type { PendingMessageQueue } from '../loop/PendingMessageQueue'

export function attachSteeringObserver(agent: Agent, queue: PendingMessageQueue): void {
  if (agent.params.providerId === 'claude-code') return

  agent.on('prepareStep', async ({ messages }) => {
    const drained = queue.drain()
    if (drained.length === 0) return undefined

    const ui: UIMessage[] = drained.map((msg) => ({
      id: msg.id,
      role: 'user' as const,
      parts: msg.data?.parts ?? []
    }))
    const additional = await convertToModelMessages(ui)
    return { messages: [...messages, ...additional] }
  })
}
