import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  updateMock,
  deleteMock,
  deleteByAgentIdMock,
  deleteByIdsMock,
  listSessionMessagesMock,
  searchSessionMessagesMock,
  deleteSessionMessageMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listByCursorMock: vi.fn(),
  createSessionMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  deleteByAgentIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  searchSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listByCursor: listByCursorMock,
    createSession: createSessionMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    deleteByAgentId: deleteByAgentIdMock,
    deleteByIds: deleteByIdsMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    search: searchSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions', () => {
    it('forwards trimmed search to agentSessionService.listByCursor', async () => {
      const response = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].GET({
        query: {
          search: '  deploy  ',
          limit: '10'
        }
      } as never)

      expect(listByCursorMock).toHaveBeenCalledWith({
        search: 'deploy',
        limit: 10
      })
      expect(result).toBe(response)
    })

    it('rejects blank search before calling the service', async () => {
      await expect(
        agentSessionHandlers['/agent-sessions'].GET({
          query: {
            search: '   '
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(listByCursorMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions/messages/search', () => {
    it('forwards normalized session message search query', async () => {
      const response = { items: [], nextCursor: undefined }
      searchSessionMessagesMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/messages/search'].GET({
        query: {
          q: '  needle  ',
          sessionId: 'session-1',
          limit: '10',
          createdAtFrom: '2026-05-01T00:00:00.000Z'
        }
      } as never)

      expect(searchSessionMessagesMock).toHaveBeenCalledWith({
        q: 'needle',
        sessionId: 'session-1',
        limit: 10,
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
      expect(result).toBe(response)
    })
  })

  describe('/agents/:agentId/sessions', () => {
    it('delegates agent-scoped session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a'], deletedCount: 1 }
      deleteByAgentIdMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agents/:agentId/sessions'].DELETE({
        params: { agentId: 'agent-1' }
      } as never)

      expect(deleteByAgentIdMock).toHaveBeenCalledWith('agent-1')
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })
  })

  describe('/agent-sessions', () => {
    it('delegates selected session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a', 'session-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].DELETE({
        body: { ids: ['session-a', 'session-b'] }
      } as never)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['session-a', 'session-b'])
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })
  })
})
