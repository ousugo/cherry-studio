import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const AgentWorkspaceNameSchema = z.string().min(1)
export const AgentWorkspacePathSchema = z.string().min(1)
export const AgentAgentWorkspaceTypeSchema = z.enum(['user', 'system'])
export type AgentAgentWorkspaceType = z.infer<typeof AgentAgentWorkspaceTypeSchema>

export const AgentWorkspaceEntitySchema = z.strictObject({
  id: z.string(),
  name: AgentWorkspaceNameSchema,
  path: AgentWorkspacePathSchema,
  type: AgentAgentWorkspaceTypeSchema,
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AgentWorkspaceEntity = z.infer<typeof AgentWorkspaceEntitySchema>

// `name` is optional — the service derives it from the path basename when omitted.
export const CreateAgentWorkspaceSchema = AgentWorkspaceEntitySchema.pick({ path: true, name: true }).partial({
  name: true
})
export type CreateAgentWorkspaceDto = z.infer<typeof CreateAgentWorkspaceSchema>

export const UpdateAgentWorkspaceSchema = AgentWorkspaceEntitySchema.pick({ name: true })
export type UpdateAgentWorkspaceDto = z.infer<typeof UpdateAgentWorkspaceSchema>

export type AgentWorkspaceSchemas = {
  '/agent-workspaces': {
    GET: {
      response: AgentWorkspaceEntity[]
    }
    // find-or-create by path: idempotent on the `agent_AgentWorkspace.path` unique index.
    POST: {
      body: CreateAgentWorkspaceDto
      response: AgentWorkspaceEntity
    }
  }

  '/agent-workspaces/:workspaceId': {
    GET: {
      params: { workspaceId: string }
      response: AgentWorkspaceEntity
    }
    PATCH: {
      params: { workspaceId: string }
      body: UpdateAgentWorkspaceDto
      response: AgentWorkspaceEntity
    }
    DELETE: {
      params: { workspaceId: string }
      response: void
    }
  }
} & OrderEndpoints<'/agent-workspaces'>
