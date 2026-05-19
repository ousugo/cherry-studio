import { workspaceTable } from '@data/db/schemas/workspace'
import { WorkspaceService, workspaceService } from '@data/services/WorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('WorkspaceService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of WorkspaceService', () => {
    expect(workspaceService).toBeInstanceOf(WorkspaceService)
  })

  it('normalizes paths, creates the directory, and dedupes by path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const rawPath = path.join(root, 'project', '..', 'project')
    const normalizedPath = path.join(root, 'project')

    const first = await workspaceService.findOrCreateByPath(rawPath)
    const second = await workspaceService.findOrCreateByPath(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath
    })
    const stats = await stat(normalizedPath)
    expect(stats.isDirectory()).toBe(true)

    const rows = await dbh.db.select().from(workspaceTable).where(eq(workspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const first = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await workspaceService.findOrCreateByPath(path.join(root, 'second'))

    const workspaces = await workspaceService.list()

    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
  })

  it('rejects relative workspace paths', async () => {
    await expect(workspaceService.findOrCreateByPath('relative/project')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
  })
})
