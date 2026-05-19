import { agentService } from '@data/services/AgentService'
import { sessionService } from '@data/services/SessionService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { workspaceService } from '@data/services/WorkspaceService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { CreateTemporarySessionDto } from '@shared/data/api/schemas/temporaryChats'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import { v4 as uuidv4 } from 'uuid'

type TemporarySessionRow = {
  id: string
  agentId: string
  name: string
  description: string
  workspaceId?: string
  createdAt: number
  updatedAt: number
}

function rowToSession(row: TemporarySessionRow, workspace: WorkspaceEntity | null): AgentSessionEntity {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description,
    workspaceId: row.workspaceId ?? null,
    workspace,
    orderKey: '',
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class TemporarySessionService {
  private readonly sessions = new Map<string, TemporarySessionRow>()

  async createSession(dto: CreateTemporarySessionDto): Promise<AgentSessionEntity> {
    const agentId = dto.agentId?.trim()
    if (!agentId) {
      throw DataApiErrorFactory.validation({ agentId: ['is required'] })
    }

    // Resolve the workspace eagerly so the returned entity carries it for
    // display; an invalid id surfaces as a precise 404 before the row is kept.
    const workspace = dto.workspaceId ? await workspaceService.getById(dto.workspaceId) : null

    const now = Date.now()
    const row: TemporarySessionRow = {
      id: uuidv4(),
      agentId,
      name: dto.name?.trim() || 'Untitled',
      description: dto.description ?? '',
      workspaceId: workspace?.id,
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(row.id, row)
    return rowToSession(row, workspace)
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.sessions.delete(id)) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }
  }

  async persist(id: string): Promise<AgentSessionEntity> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }

    const agent = await agentService.getAgent(row.agentId)
    if (!agent) {
      throw DataApiErrorFactory.notFound('Agent', row.agentId)
    }
    if (!agent.model) {
      throw DataApiErrorFactory.validation({ agentId: ['agent has no model configured'] })
    }

    this.sessions.delete(id)
    try {
      return await sessionService.createSession(
        {
          agentId: row.agentId,
          name: row.name,
          description: row.description,
          workspaceId: row.workspaceId
        },
        { id: row.id }
      )
    } catch (err) {
      this.sessions.set(id, row)
      throw err
    }
  }
}

export const temporarySessionService = new TemporarySessionService()
