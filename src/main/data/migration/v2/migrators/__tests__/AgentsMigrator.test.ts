import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { LegacyAgentsDbReader } from '../../utils/LegacyAgentsDbReader'
import { AgentsMigrator, backfillAgentOrderKeys } from '../AgentsMigrator'
import { AGENTS_TABLE_MIGRATION_SPECS } from '../mappings/AgentsDbMappings'

function createCounts() {
  return {
    agents: 1,
    sessions: 2,
    skills: 3,
    agent_skills: 4,
    scheduled_tasks: 5,
    task_run_logs: 6,
    channels: 7,
    channel_task_subscriptions: 8,
    session_messages: 9
  }
}

function createSchemaInfo() {
  return {
    agents: { exists: true, columns: new Set(['id', 'accessible_paths']) },
    sessions: { exists: true, columns: new Set(['id', 'agent_id', 'accessible_paths']) },
    skills: { exists: true, columns: new Set(['id']) },
    agent_skills: { exists: true, columns: new Set(['agent_id', 'skill_id']) },
    scheduled_tasks: { exists: true, columns: new Set(['id']) },
    task_run_logs: { exists: true, columns: new Set(['id']) },
    channels: { exists: true, columns: new Set(['id']) },
    channel_task_subscriptions: { exists: true, columns: new Set(['channel_id']) },
    session_messages: { exists: true, columns: new Set(['id']) }
  }
}

function createMigrationContext(overrides: Record<string, unknown> = {}) {
  return {
    paths: {
      legacyAgentDbFile: '/mock/Data/agents.db'
    },
    ...overrides
  } as never
}

function getExecutedSql(run: ReturnType<typeof vi.fn>) {
  return run.mock.calls.map(([statement]) =>
    statement.queryChunks
      ?.map((chunk: unknown) => {
        if (typeof chunk === 'string' || typeof chunk === 'number') return String(chunk)
        if (chunk && typeof chunk === 'object' && 'value' in chunk) {
          return (chunk as { value: string[] }).value.join('')
        }
        return ''
      })
      .join('')
  )
}

describe('AgentsMigrator', () => {
  let migrator: AgentsMigrator

  beforeEach(() => {
    migrator = new AgentsMigrator()
    vi.restoreAllMocks()
  })

  it('prepare skips cleanly when no legacy agents db exists', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue(null)

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual(['agents.db not found - no agents data to migrate'])
  })

  it('prepare counts all legacy agents rows', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const result = await migrator.prepare(createMigrationContext())

    expect(result.success).toBe(true)
    expect(result.itemCount).toBe(45)
  })

  it('execute attaches the legacy db and imports every table inside a FK-off transaction', async () => {
    // Return `{ rowsAffected: 0 }` so the model-id UPDATE transform can read
    // its result cleanly; existing assertions look at call args, not returns.
    const run = vi.fn().mockResolvedValue({ rowsAffected: 0 })
    // transformAgentBlocksToParts calls db.select().from().orderBy(); remapAgentPrefixIds
    // calls db.select().from().where(). Return empty arrays so both loops are no-ops.
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]), where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    // remapAgentPrefixIds runs PRAGMA foreign_key_check via db.all; empty => no FK violations.
    const all = vi.fn().mockResolvedValue([])

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    const result = await migrator.execute(createMigrationContext({ db: { run, select, update, all } }))

    expect(result.success).toBe(true)
    expect(result.processedCount).toBe(45)

    const outer = getExecutedSql(run)
    // Import phase: ATTACH → PRAGMA FK OFF → BEGIN → [INSERTs] → COMMIT
    expect(outer[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(outer[1]).toBe('PRAGMA foreign_keys = OFF')
    expect(outer[2]).toBe('BEGIN')
    // After import COMMIT: remapAgentPrefixIds emits PRAGMA FK OFF → BEGIN → COMMIT → PRAGMA FK ON
    // Then execute() finally emits PRAGMA FK ON → DETACH
    // run tail: ...COMMIT(import), PRAGMA FK OFF, BEGIN, COMMIT, PRAGMA FK ON, PRAGMA FK ON, DETACH
    expect(outer.at(-7)).toBe('COMMIT')
    expect(outer.at(-6)).toBe('PRAGMA foreign_keys = OFF')
    expect(outer.at(-5)).toBe('BEGIN')
    expect(outer.at(-4)).toBe('COMMIT')
    expect(outer.at(-3)).toBe('PRAGMA foreign_keys = ON')
    expect(outer.at(-2)).toBe('PRAGMA foreign_keys = ON')
    expect(outer.at(-1)).toBe('DETACH DATABASE agents_legacy')
    // INSERT statements run between BEGIN and COMMIT — anchor off COMMIT's
    // position rather than a fixed negative offset so the post-copy model-id
    // transform UPDATEs (added after COMMIT) don't invalidate the slice math.
    const commitIndex = outer.indexOf('COMMIT')
    expect(commitIndex).toBeGreaterThan(2)
    const importCalls = outer.slice(3, commitIndex)
    expect(importCalls.slice(0, 2)).toEqual([
      'CREATE TEMP TABLE IF NOT EXISTS session_workspace_map (session_id TEXT PRIMARY KEY, workspace_id TEXT)',
      'DELETE FROM session_workspace_map'
    ])
    const insertCalls = importCalls.filter((stmt) => stmt?.startsWith('INSERT INTO'))
    expect(insertCalls).toHaveLength(AGENTS_TABLE_MIGRATION_SPECS.length)
    // No old-prefix IDs returned → no UPDATE calls
    expect(update).not.toHaveBeenCalled()
    const postCopy = outer.slice(commitIndex + 1, -2)
    expect(postCopy).toEqual(['PRAGMA foreign_keys = OFF', 'BEGIN', 'COMMIT', 'PRAGMA foreign_keys = ON'])
  })

  it('backfills agent order keys from legacy sort_order before id remap', async () => {
    const all = vi.fn().mockResolvedValue([{ id: 'agent-b' }, { id: 'agent-a' }])
    const run = vi.fn().mockResolvedValue(undefined)

    await backfillAgentOrderKeys({ all, run } as never)

    const [query] = all.mock.calls[0]
    expect(query.queryChunks[0]?.value?.[0]).toContain('LEFT JOIN agents_legacy.agents')
    expect(query.queryChunks[0]?.value?.[0]).toContain('ORDER BY COALESCE(s.sort_order, 0) ASC')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('re-enables FK and detaches when an import statement fails inside the transaction', async () => {
    // First 5 calls succeed (ATTACH, FK_OFF, BEGIN, workspace-map setup),
    // 6th (first import INSERT) fails.
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined) // ATTACH
      .mockResolvedValueOnce(undefined) // PRAGMA foreign_keys = OFF
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // CREATE TEMP TABLE
      .mockResolvedValueOnce(undefined) // DELETE FROM session_workspace_map
      .mockRejectedValueOnce(new Error('insert failed')) // first INSERT fails
      .mockResolvedValue(undefined) // ROLLBACK, FK_ON, DETACH

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    await expect(
      migrator.execute(createMigrationContext({ db: { run, all: vi.fn().mockResolvedValue([]) } }))
    ).rejects.toThrow('insert failed')

    const executed = getExecutedSql(run)
    expect(executed).toContain('ROLLBACK')
    expect(executed).toContain('PRAGMA foreign_keys = ON')
    expect(executed.at(-1)).toBe('DETACH DATABASE agents_legacy')
    expect(executed.some((stmt) => stmt === 'DELETE FROM agent')).toBe(false)
  })

  it('stages only the primary session workspace path, dedupes by path, and falls back to agent path', async () => {
    const run = vi.fn().mockResolvedValue({ rowsAffected: 0 })
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]), orderBy: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    const all = vi
      .fn()
      .mockResolvedValueOnce([
        {
          session_id: 'session-1',
          agent_id: 'agent-1',
          session_accessible_paths: JSON.stringify(['/tmp/work-a', '/tmp/ignored-extra']),
          agent_accessible_paths: JSON.stringify(['/tmp/agent-fallback']),
          sort_order: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        },
        {
          session_id: 'session-2',
          agent_id: 'agent-1',
          session_accessible_paths: JSON.stringify(['/tmp/work-a']),
          agent_accessible_paths: JSON.stringify(['/tmp/agent-fallback']),
          sort_order: 1,
          created_at: '2026-01-02T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z'
        },
        {
          session_id: 'session-3',
          agent_id: 'agent-2',
          session_accessible_paths: JSON.stringify(['relative/path']),
          agent_accessible_paths: JSON.stringify(['/tmp/agent-b']),
          sort_order: 2,
          created_at: '2026-01-03T00:00:00.000Z',
          updated_at: '2026-01-03T00:00:00.000Z'
        }
      ])
      .mockResolvedValue([])

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    await migrator.prepare(createMigrationContext())
    const result = await migrator.execute(
      createMigrationContext({
        paths: { legacyAgentDbFile: '/mock/Data/agents.db', agentWorkspacesDir: '/mock/Data/Agents' },
        db: { run, select, update, all }
      })
    )

    expect(result.processedCount).toBe(47)
    const executed = getExecutedSql(run)
    const workspaceInserts = executed.filter((stmt) => stmt?.startsWith('INSERT INTO agent_workspace '))
    const mapInserts = executed.filter((stmt) => stmt?.startsWith('INSERT INTO session_workspace_map '))
    const firstWorkspaceInsertIndex = executed.findIndex((stmt) => stmt?.startsWith('INSERT INTO agent_workspace '))
    const firstMapInsertIndex = executed.findIndex((stmt) => stmt?.startsWith('INSERT INTO session_workspace_map '))
    const agentImportIndex = executed.findIndex((stmt) => stmt?.startsWith('INSERT INTO agent '))
    const sessionImportIndex = executed.findIndex((stmt) => stmt?.startsWith('INSERT INTO agent_session '))

    expect(workspaceInserts).toHaveLength(2)
    expect(workspaceInserts.join('\n')).toContain('/tmp/work-a')
    expect(workspaceInserts.join('\n')).toContain('/tmp/agent-b')
    expect(workspaceInserts.join('\n')).not.toContain('/tmp/ignored-extra')
    expect(mapInserts).toHaveLength(3)
    expect(firstWorkspaceInsertIndex).toBeGreaterThan(-1)
    expect(firstMapInsertIndex).toBeGreaterThan(firstWorkspaceInsertIndex)
    expect(agentImportIndex).toBeGreaterThan(firstMapInsertIndex)
    expect(sessionImportIndex).toBeGreaterThan(agentImportIndex)
  })

  it('validate fails when imported table counts are lower than the expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const all = vi
      .fn()
      .mockResolvedValueOnce([]) // legacy session workspace rows
      .mockResolvedValueOnce([{ count: 0 }]) // workspace target
      .mockResolvedValueOnce([{ count: 0 }]) // invalid session workspace bindings
      .mockResolvedValueOnce([]) // target session workspace path counts
      .mockResolvedValueOnce([{ count: 0 }]) // agent target (expected 1 → mismatch)
      .mockResolvedValueOnce([{ count: 1 }]) // agent expected
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session target
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session expected
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill target
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill expected
      .mockResolvedValueOnce([{ count: 5 }]) // agent_task target
      .mockResolvedValueOnce([{ count: 5 }]) // agent_task expected
      .mockResolvedValueOnce([{ count: 6 }]) // agent_task_run_log target
      .mockResolvedValueOnce([{ count: 6 }]) // agent_task_run_log expected
      .mockResolvedValueOnce([{ count: 6 }]) // agent_channel target (expected 7 → mismatch)
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel expected
      .mockResolvedValueOnce([{ count: 8 }]) // agent_channel_task target
      .mockResolvedValueOnce([{ count: 8 }]) // agent_channel_task expected
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message target
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(false)
    expect(result.errors.map((error) => error.key)).toEqual(['agent_count_mismatch', 'agent_channel_count_mismatch'])
    expect(result.stats.sourceCount).toBe(45)
    expect(result.stats.targetCount).toBe(43)
  })

  it('validate skips specs whose source table is missing from the legacy db', async () => {
    // Reproduces the production crash where a legacy agents.db lacks newer
    // tables (e.g. agent_skills): validate would otherwise SELECT FROM
    // agents_legacy.agent_skills and the libsql client would raise
    // "no such table: agents_legacy.agent_skills".
    const partialSchema = createSchemaInfo()
    partialSchema.agent_skills = { exists: false, columns: new Set() }
    partialSchema.session_messages = { exists: false, columns: new Set() }
    const partialCounts = { ...createCounts(), agent_skills: 0, session_messages: 0 }

    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(partialSchema as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(partialCounts)

    // Workspace validation adds four queries, then each present spec issues two
    // queries (target count + expected count). With 7 present specs we expect
    // 18 calls, all matched (target === expected) so
    // validation succeeds. If the guard regresses, the mock will run out of
    // queued responses and return undefined, surfacing the failure.
    const all = vi.fn()
    all
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
    for (let i = 0; i < 7; i++) {
      all.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ count: 1 }])
    }

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(all).toHaveBeenCalledTimes(18)
    const queries = all.mock.calls.map(([statement]) => statement.queryChunks[0]?.value?.[0])
    expect(queries.some((q) => q?.includes('agents_legacy.agent_skills'))).toBe(false)
    expect(queries.some((q) => q?.includes('agents_legacy.session_messages'))).toBe(false)
  })

  it('validate flags target tables whose row count exceeds the expected filtered count', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const all = vi
      .fn()
      .mockResolvedValueOnce([]) // legacy session workspace rows
      .mockResolvedValueOnce([{ count: 0 }]) // workspace target
      .mockResolvedValueOnce([{ count: 0 }]) // invalid session workspace bindings
      .mockResolvedValueOnce([]) // target session workspace path counts
      .mockResolvedValueOnce([{ count: 2 }]) // agent target (expected 1 → too high)
      .mockResolvedValueOnce([{ count: 1 }]) // agent expected
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session target
      .mockResolvedValueOnce([{ count: 2 }]) // agent_session expected
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill target
      .mockResolvedValueOnce([{ count: 3 }]) // agent_global_skill expected
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill target
      .mockResolvedValueOnce([{ count: 4 }]) // agent_skill expected
      .mockResolvedValueOnce([{ count: 5 }]) // agent_task target
      .mockResolvedValueOnce([{ count: 5 }]) // agent_task expected
      .mockResolvedValueOnce([{ count: 6 }]) // agent_task_run_log target
      .mockResolvedValueOnce([{ count: 6 }]) // agent_task_run_log expected
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel target
      .mockResolvedValueOnce([{ count: 7 }]) // agent_channel expected
      .mockResolvedValueOnce([{ count: 8 }]) // agent_channel_task target
      .mockResolvedValueOnce([{ count: 8 }]) // agent_channel_task expected
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message target
      .mockResolvedValueOnce([{ count: 9 }]) // agent_session_message expected

    const run = vi.fn().mockResolvedValue(undefined)

    await migrator.prepare(createMigrationContext())
    const result = await migrator.validate(createMigrationContext({ db: { all, run } }))

    expect(result.success).toBe(false)
    expect(result.errors).toEqual([
      expect.objectContaining({
        key: 'agent_count_mismatch',
        expected: 1,
        actual: 2,
        message: expect.stringContaining('too high')
      })
    ])
  })

  it('resolves the legacy db path once and reuses it across phases', async () => {
    const resolvePath = vi
      .spyOn(LegacyAgentsDbReader.prototype, 'resolvePath')
      .mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue({ rowsAffected: 0 })
    const get = vi.fn().mockResolvedValue({ count: 8 })
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]), where: vi.fn().mockResolvedValue([]) })
    })
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    })
    const all = vi.fn().mockResolvedValue([])
    const migrationContext = createMigrationContext({ db: { run, get, select, update, all } })

    await migrator.prepare(migrationContext)
    await migrator.execute(migrationContext)
    await migrator.validate(migrationContext)

    expect(resolvePath).toHaveBeenCalledTimes(1)
  })

  it('validate attaches the legacy db to compare against expected filtered counts', async () => {
    vi.spyOn(LegacyAgentsDbReader.prototype, 'resolvePath').mockReturnValue('/mock/feature.agents.db_file')
    vi.spyOn(LegacyAgentsDbReader.prototype, 'inspectSchema').mockResolvedValue(createSchemaInfo() as never)
    vi.spyOn(LegacyAgentsDbReader.prototype, 'countRows').mockResolvedValue(createCounts())

    const run = vi.fn().mockResolvedValue(undefined)
    const all = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ count: 1 }])

    await migrator.prepare(createMigrationContext())
    await migrator.validate(createMigrationContext({ db: { run, all } }))

    expect(getExecutedSql(run)[0]).toBe("ATTACH DATABASE '/mock/feature.agents.db_file' AS agents_legacy")
    expect(getExecutedSql(run).at(-1)).toBe('DETACH DATABASE agents_legacy')
  })
})
