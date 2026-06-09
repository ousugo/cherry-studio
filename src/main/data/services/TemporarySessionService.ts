import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { workspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { CreateTemporarySessionDto } from '@shared/data/api/schemas/temporaryChats'
import { v4 as uuidv4 } from 'uuid'

type TemporarySessionRow = {
  id: string
  agentId: string
  name: string
  description: string
  workspaceId: string
  workspaceType: AgentWorkspaceEntity['type']
  createdAt: number
  updatedAt: number
}

function rowToSession(row: TemporarySessionRow, workspace: AgentWorkspaceEntity): AgentSessionEntity {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description,
    workspaceId: row.workspaceId,
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

    const now = Date.now()
    const id = uuidv4()
    // Resolve the workspace eagerly so the returned entity carries it for
    // display; an invalid id surfaces as a precise 404 before the row is kept.
    const workspace =
      dto.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM
        ? await agentWorkspaceService.createSystemAgentWorkspaceForSession(id)
        : await agentWorkspaceService.getById(dto.workspace.workspaceId)

    const row: TemporarySessionRow = {
      id,
      agentId,
      name: dto.name?.trim() || 'Untitled',
      description: dto.description ?? '',
      workspaceId: workspace.id,
      workspaceType: workspace.type,
      createdAt: now,
      updatedAt: now
    }

    this.sessions.set(row.id, row)
    return rowToSession(row, workspace)
  }

  async deleteSession(id: string): Promise<void> {
    const row = this.sessions.get(id)
    if (!row) {
      throw DataApiErrorFactory.notFound('TemporarySession', id)
    }
    if (row.workspaceType === AGENT_WORKSPACE_TYPE.SYSTEM) {
      await workspaceWorkflowService.deleteWorkspace(row.workspaceId)
    }
    this.sessions.delete(id)
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
      const workspace =
        row.workspaceType === AGENT_WORKSPACE_TYPE.SYSTEM
          ? { type: AGENT_WORKSPACE_TYPE.SYSTEM }
          : { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: row.workspaceId }
      return await agentSessionService.createSession(
        {
          agentId: row.agentId,
          name: row.name,
          description: row.description,
          workspace
        },
        {
          id: row.id,
          systemWorkspaceId: row.workspaceType === AGENT_WORKSPACE_TYPE.SYSTEM ? row.workspaceId : undefined
        }
      )
    } catch (err) {
      this.sessions.set(id, row)
      throw err
    }
  }
}

export const temporarySessionService = new TemporarySessionService()
