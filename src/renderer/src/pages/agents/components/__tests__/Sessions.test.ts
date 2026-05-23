import { describe, expect, it } from 'vitest'

import type { SessionListItem } from '../SessionList.helpers'
import { buildCreateSessionSeed, findLatestCreateSessionSeed } from '../Sessions'

const workspace = (path: string) => ({
  id: 'workspace-1',
  name: 'project',
  path,
  orderKey: 'workspace-order-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const session = (overrides: Partial<SessionListItem> = {}) =>
  ({
    id: 'session-1',
    agentId: 'agent-1',
    workspaceId: 'workspace-1',
    workspace: workspace('/Users/jd/project-a'),
    pinned: false,
    ...overrides
  }) as SessionListItem

describe('buildCreateSessionSeed', () => {
  it('copies the agent and workspace id from the source session', () => {
    expect(buildCreateSessionSeed(session({ agentId: 'agent-2', workspaceId: 'workspace-2' }))).toEqual({
      agentId: 'agent-2',
      workspaceId: 'workspace-2'
    })
  })

  it('falls back to the embedded workspace path when the workspace id is missing', () => {
    expect(
      buildCreateSessionSeed(session({ workspaceId: undefined, workspace: workspace('/Users/jd/project-b') }))
    ).toEqual({
      agentId: 'agent-1',
      workspacePath: '/Users/jd/project-b'
    })
  })

  it('returns null when the source session has no agent', () => {
    expect(buildCreateSessionSeed(session({ agentId: undefined }))).toBeNull()
  })
})

describe('findLatestCreateSessionSeed', () => {
  it('uses the latest unpinned matching session', () => {
    expect(
      findLatestCreateSessionSeed([
        session({
          id: 'pinned-session',
          agentId: 'agent-pinned',
          pinned: true,
          updatedAt: '2026-01-04T00:00:00.000Z'
        }),
        session({
          id: 'older-session',
          agentId: 'agent-older',
          workspaceId: 'workspace-older',
          updatedAt: '2026-01-02T00:00:00.000Z'
        }),
        session({
          id: 'newer-session',
          agentId: 'agent-newer',
          workspaceId: 'workspace-newer',
          updatedAt: '2026-01-03T00:00:00.000Z'
        })
      ])
    ).toEqual({ agentId: 'agent-newer', workspaceId: 'workspace-newer' })
  })

  it('honors the group predicate before choosing the seed', () => {
    expect(
      findLatestCreateSessionSeed(
        [
          session({
            id: 'session-a',
            agentId: 'agent-a',
            workspaceId: 'workspace-a',
            updatedAt: '2026-01-03T00:00:00.000Z'
          }),
          session({
            id: 'session-b',
            agentId: 'agent-b',
            workspaceId: 'workspace-b',
            updatedAt: '2026-01-02T00:00:00.000Z'
          })
        ],
        (candidate) => candidate.id === 'session-b'
      )
    ).toEqual({ agentId: 'agent-b', workspaceId: 'workspace-b' })
  })
})
