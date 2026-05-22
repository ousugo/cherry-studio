import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const { createNodeFsMock } = await import('@test-helpers/mocks/nodeFsMock')
  return createNodeFsMock()
})

import { resolveAccessiblePaths } from '../agentUtils'

describe('resolveAccessiblePaths', () => {
  const testId = 'agent_1234567890_abcdefghi'
  // Matches the stub in tests/main.setup.ts → application.getPath('feature.agents.workspaces')
  const workspaceRoot = '/mock/feature.agents.workspaces'
  const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  function expectDefaultWorkspacePath(paths: string[]) {
    expect(paths).toHaveLength(1)
    expect(path.dirname(paths[0])).toBe(workspaceRoot)
    expect(path.basename(paths[0])).toMatch(uuidV4Pattern)
    expect(path.basename(paths[0])).not.toBe(testId.slice(-9))
  }

  it('assigns a default path when paths is undefined', () => {
    expectDefaultWorkspacePath(resolveAccessiblePaths(undefined))
  })

  it('assigns a default path when paths is empty array', () => {
    expectDefaultWorkspacePath(resolveAccessiblePaths([]))
  })

  it('passes through provided paths unchanged', () => {
    expect(resolveAccessiblePaths(['/some/path'])).toEqual([path.normalize('/some/path')])
  })
})
