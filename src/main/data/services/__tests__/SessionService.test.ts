import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { workspaceTable } from '@data/db/schemas/workspace'
import { sessionService } from '@data/services/SessionService'
import { workspaceService } from '@data/services/WorkspaceService'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('SessionService', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-session-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, 'Agents', filename) : path.join(root, 'Agents')
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    await dbh.db.insert(agentTable).values({
      id: 'agent-session-test',
      type: 'claude-code',
      name: 'Session Test Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds a session to an explicit workspace', async () => {
    const workspace = await workspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspaceId: workspace.id
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits the latest sibling workspace when no workspace is provided', async () => {
    const firstWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const secondWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'second'))

    await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'First',
      workspaceId: firstWorkspace.id
    })
    await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Second',
      workspaceId: secondWorkspace.id
    })

    const inherited = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Inherited'
    })

    expect(inherited.workspaceId).toBe(secondWorkspace.id)
    expect(inherited.workspace?.path).toBe(secondWorkspace.path)
  })

  it('creates and binds a default workspace when none can be inherited', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Default'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path).toBeTruthy()
    const rows = await dbh.db.select().from(workspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('does not leave an orphan default workspace row when session creation fails', async () => {
    await expect(
      sessionService.createSession({
        agentId: 'agent-session-test',
        name: null as never
      })
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(workspaceTable)
    expect(rows).toHaveLength(0)
  })
})
