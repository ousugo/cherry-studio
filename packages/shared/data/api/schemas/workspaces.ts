import * as z from 'zod'

import type { OrderEndpoints } from './_endpointHelpers'

export const WorkspaceNameSchema = z.string().min(1)
export const WorkspacePathSchema = z.string().min(1)

export const WorkspaceEntitySchema = z.strictObject({
  id: z.string(),
  name: WorkspaceNameSchema,
  path: WorkspacePathSchema,
  orderKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type WorkspaceEntity = z.infer<typeof WorkspaceEntitySchema>

// `name` is optional — the service derives it from the path basename when omitted.
export const CreateWorkspaceSchema = WorkspaceEntitySchema.pick({ path: true, name: true }).partial({ name: true })
export type CreateWorkspaceDto = z.infer<typeof CreateWorkspaceSchema>

export type WorkspaceSchemas = {
  '/workspaces': {
    GET: {
      response: WorkspaceEntity[]
    }
    // find-or-create by path: idempotent on the `agent_workspace.path` unique index.
    POST: {
      body: CreateWorkspaceDto
      response: WorkspaceEntity
    }
  }

  '/workspaces/:workspaceId': {
    GET: {
      params: { workspaceId: string }
      response: WorkspaceEntity
    }
    DELETE: {
      params: { workspaceId: string }
      response: void
    }
  }
} & OrderEndpoints<'/workspaces'>
