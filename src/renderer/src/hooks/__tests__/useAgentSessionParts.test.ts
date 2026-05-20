import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInfiniteFlatItems: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useMutation: vi.fn()
}))

const { toAgentSessionUIMessage } = await import('../useAgentSessionParts')

describe('toAgentSessionUIMessage', () => {
  it('projects the flattened agent session message row from data.parts', () => {
    const row = {
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'from parts' }] },
      searchableText: 'from parts',
      status: 'success',
      modelId: 'anthropic::claude',
      modelSnapshot: { id: 'claude', name: 'Claude', provider: 'anthropic' },
      traceId: 'trace-1',
      stats: { totalTokens: 10 },
      agentSessionId: 'agent-session-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      content: {
        message: {
          id: 'legacy-wrapper-message',
          data: { parts: [{ type: 'text', text: 'wrong' }] }
        }
      }
    } as AgentSessionMessageEntity & { content: unknown }

    expect(toAgentSessionUIMessage(row)).toMatchObject({
      id: 'message-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'from parts' }],
      metadata: {
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'success',
        modelId: 'anthropic::claude',
        modelSnapshot: { id: 'claude', name: 'Claude', provider: 'anthropic' },
        traceId: 'trace-1',
        stats: { totalTokens: 10 }
      }
    })
  })
})
