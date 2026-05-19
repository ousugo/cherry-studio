import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import type { DbType } from '@data/db/types'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { asc, eq, sql } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { LegacyAgentsDbReader } from '../utils/LegacyAgentsDbReader'
import { BaseMigrator } from './BaseMigrator'
import {
  AGENTS_TABLE_MIGRATION_SPECS,
  type AgentsSchemaInfo,
  type AgentsTableRowCounts,
  buildAgentsImportStatements,
  createEmptyAgentsSchemaInfo,
  getTotalAgentsRowCount,
  quoteSqlitePath
} from './mappings/AgentsDbMappings'
import { normalizeStatus, transformBlocksToParts } from './mappings/ChatMappings'
import { remapAgentPrefixIds } from './remapAgentPrefixIds'

const logger = loggerService.withContext('AgentsMigrator')

export class AgentsMigrator extends BaseMigrator {
  readonly id = 'agents'
  readonly name = 'Agents'
  readonly description = 'Migrate legacy agents.db data into the main SQLite database'
  readonly order = 2.5

  private sourceCounts: AgentsTableRowCounts = this.createEmptyCounts()
  private sourceDbPath: string | null | undefined = undefined
  private sourceSchemaInfo: AgentsSchemaInfo = createEmptyAgentsSchemaInfo()
  private reader: LegacyAgentsDbReader | null = null
  private derivedWorkspaceCount = 0

  override reset(): void {
    this.sourceCounts = this.createEmptyCounts()
    this.sourceDbPath = undefined
    this.sourceSchemaInfo = createEmptyAgentsSchemaInfo()
    this.reader = null
    this.derivedWorkspaceCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found at prepare phase')
      return {
        success: true,
        itemCount: 0,
        warnings: ['agents.db not found - no agents data to migrate']
      }
    }

    this.sourceSchemaInfo = await reader.inspectSchema()
    this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)

    // Debug: Log schema detection results
    logger.info('AgentsMigrator prepare:', {
      dbPath,
      tablesDetected: Object.entries(this.sourceSchemaInfo)
        .filter(([, v]) => v.exists)
        .map(([k]) => k),
      rowCounts: this.sourceCounts,
      totalRows: getTotalAgentsRowCount(this.sourceCounts)
    })

    return {
      success: true,
      itemCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found, skipping agents migration')
      return { success: true, processedCount: 0 }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceSchemaInfo = await reader.inspectSchema()
      this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)
    }

    // Debug logging: show source schema detection and counts
    logger.info('Source schema detected:', {
      dbPath,
      tableExists: Object.fromEntries(Object.entries(this.sourceSchemaInfo).map(([k, v]) => [k, v.exists])),
      sourceCounts: this.sourceCounts
    })

    const statements = buildAgentsImportStatements(dbPath, this.sourceSchemaInfo)

    logger.debug('Generated SQL statements:', {
      statementCount: statements.length,
      statements: statements.map((s, i) => ({ index: i, sql: s.substring(0, 200) }))
    })

    // ATTACH/DETACH cannot live inside a transaction, and libsql creates a
    // fresh connection per transaction() call — meaning agents_legacy would
    // not be visible inside db.transaction(). Use manual BEGIN/COMMIT/ROLLBACK
    // via db.run() so ATTACH, all INSERTs, and DETACH share the same connection.
    const importStatements = statements.slice(1, -1)
    let isAttached = false
    let committed = false
    let pendingError: unknown = null

    try {
      await ctx.db.run(sql.raw(statements[0])) // ATTACH DATABASE …
      isAttached = true
      await ctx.db.run(sql.raw('PRAGMA foreign_keys = OFF'))
      await ctx.db.run(sql.raw('BEGIN'))

      this.derivedWorkspaceCount = await stageSessionWorkspaces(ctx, this.sourceSchemaInfo)

      for (const statement of importStatements) {
        logger.debug('Executing SQL:', { sql: statement.substring(0, 200) })
        await ctx.db.run(sql.raw(statement))
      }

      // Atomic post-INSERT shape reconciliation — runs INSIDE the BEGIN/COMMIT
      // so a failure rolls everything back instead of leaving rows in an
      // intermediate sentinel state (`order_key=''` or v1 `blocks: [...]`).
      //
      // Order:
      //   1. backfillAgentOrderKeys — joins `agents_legacy.{agents,sessions}`,
      //      so MUST run while ATTACH is live and BEFORE remap rewrites ids.
      //   2. transformAgentBlocksToParts — no ordering constraint with remap;
      //      operates on `content` JSON, ids unchanged.
      await backfillAgentOrderKeys(ctx.db)
      await transformAgentBlocksToParts(ctx.db)

      await ctx.db.run(sql.raw('COMMIT'))
      committed = true
      logger.info('Agents migration transaction committed successfully')

      // Prefix-id remap runs AFTER the outer COMMIT because it opens its own
      // BEGIN/COMMIT (nested SQLite transactions are not supported). It is
      // idempotent, so a retry after a partial failure is safe.
      await remapAgentPrefixIds(ctx.db)
    } catch (error) {
      if (!committed) {
        try {
          await ctx.db.run(sql.raw('ROLLBACK'))
        } catch (rollbackError) {
          logger.error(
            'ROLLBACK failed after agents migration error — DB may be in an inconsistent state',
            rollbackError as Error
          )
        }
      }
      logger.error('Agents migration execute failed:', error as Error)
      pendingError = error
    }

    // FK re-enable must succeed: a silent failure leaves the rest of the migration
    // pipeline (and the app) running with FK enforcement off, which masks
    // referential corruption. Only overwrite pendingError if the main path succeeded —
    // otherwise the original failure is more informative.
    try {
      await ctx.db.run(sql.raw('PRAGMA foreign_keys = ON'))
    } catch (pragmaError) {
      logger.error('Failed to re-enable foreign_keys after agents migration — aborting', pragmaError as Error)
      if (!pendingError) pendingError = pragmaError
    }

    if (isAttached) {
      try {
        await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        // DETACH must not mask the original error; log loudly so it surfaces in diagnostics.
        logger.error('Failed to DETACH agents_legacy database', detachError as Error)
      }
    }

    if (pendingError) throw pendingError

    return {
      success: true,
      processedCount: getTotalAgentsRowCount(this.sourceCounts) + this.derivedWorkspaceCount
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: 0,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceSchemaInfo = await reader.inspectSchema()
      this.sourceCounts = await reader.countRows(this.sourceSchemaInfo)
    }

    const errors: ValidationError[] = []
    let targetCount = 0
    let skippedCount = 0
    const validationDetails: Array<{
      table: string
      source: number
      expected: number
      target: number
      filtered: boolean
      ok: boolean
    }> = []

    await ctx.db.run(sql.raw(`ATTACH DATABASE ${quoteSqlitePath(dbPath)} AS agents_legacy`))

    try {
      const expectedWorkspaces = await collectLegacySessionWorkspaces(ctx, this.sourceSchemaInfo)
      const workspaceRows = await ctx.db.all<{ count: number }>(
        sql.raw('SELECT COUNT(*) AS count FROM agent_workspace')
      )
      const workspaceTargetCount = Number(workspaceRows[0]?.count ?? 0)
      const workspaceExpectedCount = expectedWorkspaces.workspaces.length
      this.derivedWorkspaceCount = workspaceExpectedCount
      targetCount += workspaceTargetCount
      validationDetails.push({
        table: 'workspace',
        source: workspaceExpectedCount,
        expected: workspaceExpectedCount,
        target: workspaceTargetCount,
        filtered: true,
        ok: workspaceTargetCount === workspaceExpectedCount
      })
      if (workspaceTargetCount !== workspaceExpectedCount) {
        const direction = workspaceTargetCount < workspaceExpectedCount ? 'too low' : 'too high'
        errors.push({
          key: 'workspace_count_mismatch',
          expected: workspaceExpectedCount,
          actual: workspaceTargetCount,
          message: `workspace count ${direction}: expected ${workspaceExpectedCount}, got ${workspaceTargetCount}`
        })
      }

      const invalidSessionWorkspaceRows = await ctx.db.all<{ count: number }>(
        sql.raw(
          `SELECT COUNT(*) AS count
           FROM agent_session
           LEFT JOIN agent_workspace ON agent_workspace.id = agent_session.workspace_id
           WHERE agent_session.workspace_id IS NULL OR agent_workspace.id IS NULL`
        )
      )
      const invalidSessionWorkspaceCount = Number(invalidSessionWorkspaceRows[0]?.count ?? 0)
      if (invalidSessionWorkspaceCount > 0) {
        errors.push({
          key: 'agent_session_workspace_missing',
          expected: 0,
          actual: invalidSessionWorkspaceCount,
          message: `agent_session has ${invalidSessionWorkspaceCount} rows without a valid workspace`
        })
      }

      const targetWorkspacePathCounts = await ctx.db.all<{ path: string; count: number }>(
        sql.raw(
          `SELECT agent_workspace.path AS path, COUNT(agent_session.id) AS count
           FROM agent_session
           INNER JOIN agent_workspace ON agent_workspace.id = agent_session.workspace_id
           GROUP BY agent_workspace.path`
        )
      )
      const expectedWorkspacePathCounts = countExpectedSessionWorkspacePaths(expectedWorkspaces)
      const targetWorkspacePathCountMap = new Map(
        targetWorkspacePathCounts.map((row) => [row.path, Number(row.count ?? 0)])
      )
      for (const [workspacePath, expectedCount] of expectedWorkspacePathCounts) {
        const actualCount = targetWorkspacePathCountMap.get(workspacePath) ?? 0
        if (actualCount !== expectedCount) {
          errors.push({
            key: 'agent_session_workspace_path_mismatch',
            expected: expectedCount,
            actual: actualCount,
            message: `agent_session workspace path mismatch for ${workspacePath}: expected ${expectedCount}, got ${actualCount}`
          })
        }
      }

      for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
        // Mirror the execute-side guard in buildAgentsImportStatements: legacy DBs
        // from older app versions may lack tables added later (e.g. agent_skills).
        if (!this.sourceSchemaInfo[spec.sourceTable].exists) {
          continue
        }

        // .get() with sql.raw() crashes on zero rows in drizzle-orm/libsql; use .all() instead.
        const targetRows = await ctx.db.all<{ count: number }>(
          sql.raw(`SELECT COUNT(*) AS count FROM ${spec.targetTable}`)
        )
        const tableTargetCount = Number(targetRows[0]?.count ?? 0)
        const tableSourceCount = this.sourceCounts[spec.sourceTable]
        const validateWhere = spec.validateWhereClause ?? spec.whereClause
        const expectedRows = await ctx.db.all<{ count: number }>(
          sql.raw(
            `SELECT COUNT(*) AS count FROM agents_legacy.${spec.sourceTable}${validateWhere ? ` WHERE ${validateWhere}` : ''}`
          )
        )
        const tableExpectedCount = Number(expectedRows[0]?.count ?? 0)
        targetCount += tableTargetCount

        const hasWhereClause = !!spec.whereClause
        const tableSkippedCount = Math.max(0, tableSourceCount - tableExpectedCount)
        skippedCount += tableSkippedCount
        const ok = tableTargetCount === tableExpectedCount

        validationDetails.push({
          table: spec.targetTable,
          source: tableSourceCount,
          expected: tableExpectedCount,
          target: tableTargetCount,
          filtered: hasWhereClause,
          ok
        })

        if (!ok) {
          const direction = tableTargetCount < tableExpectedCount ? 'too low' : 'too high'
          errors.push({
            key: `${spec.targetTable}_count_mismatch`,
            expected: tableExpectedCount,
            actual: tableTargetCount,
            message: `${spec.targetTable} count ${direction}: expected ${tableExpectedCount}, got ${tableTargetCount}`
          })
        }
      }
    } finally {
      try {
        await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      } catch (detachError) {
        logger.error('Failed to DETACH agents_legacy database during validation', detachError as Error)
      }
    }

    logger.info('AgentsMigrator validation:', {
      validationDetails,
      errorCount: errors.length,
      totalSkipped: skippedCount
    })

    return {
      success: errors.length === 0,
      errors,
      stats: {
        sourceCount: getTotalAgentsRowCount(this.sourceCounts) + this.derivedWorkspaceCount,
        targetCount,
        skippedCount,
        mismatchReason: errors.length > 0 ? 'One or more agent_* tables did not match expected row counts' : undefined
      }
    }
  }

  private createReader(ctx: MigrationContext): LegacyAgentsDbReader {
    return (this.reader ??= new LegacyAgentsDbReader(ctx.paths))
  }

  private resolveSourceDbPath(reader: LegacyAgentsDbReader): string | null {
    if (this.sourceDbPath !== undefined) {
      return this.sourceDbPath
    }

    this.sourceDbPath = reader.resolvePath()
    return this.sourceDbPath
  }

  private createEmptyCounts(): AgentsTableRowCounts {
    return {
      agents: 0,
      sessions: 0,
      skills: 0,
      agent_skills: 0,
      scheduled_tasks: 0,
      task_run_logs: 0,
      channels: 0,
      channel_task_subscriptions: 0,
      session_messages: 0
    }
  }
}

type LegacySessionWorkspaceRow = {
  session_id: string
  agent_id: string
  session_accessible_paths: string | null
  agent_accessible_paths: string | null
  sort_order: number | null
  created_at: string | number | null
  updated_at: string | number | null
}

type DerivedWorkspace = {
  id: string
  name: string
  path: string
  orderKey: string
  createdAt: number
  updatedAt: number
}

type DerivedSessionWorkspaceMap = {
  sessionId: string
  workspaceId: string
}

type DerivedSessionWorkspaces = {
  workspaces: DerivedWorkspace[]
  mappings: DerivedSessionWorkspaceMap[]
}

function selectLegacySessionColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.sessions.columns.has(column) ? `sessions.${column} AS ${alias}` : `${fallbackExpr} AS ${alias}`
}

function selectLegacyAgentColumn(
  schemaInfo: AgentsSchemaInfo,
  column: string,
  alias: string,
  fallbackExpr: string
): string {
  return schemaInfo.agents.columns.has(column) ? `agents.${column} AS ${alias}` : `${fallbackExpr} AS ${alias}`
}

async function selectLegacySessionWorkspaceRows(
  db: DbType,
  schemaInfo: AgentsSchemaInfo
): Promise<LegacySessionWorkspaceRow[]> {
  if (
    !schemaInfo.agents.exists ||
    !schemaInfo.sessions.exists ||
    !schemaInfo.agents.columns.has('id') ||
    !schemaInfo.sessions.columns.has('id') ||
    !schemaInfo.sessions.columns.has('agent_id')
  ) {
    return []
  }

  const sortOrder = schemaInfo.sessions.columns.has('sort_order') ? 'COALESCE(sessions.sort_order, 0)' : '0'
  const createdAt = schemaInfo.sessions.columns.has('created_at') ? 'sessions.created_at' : 'sessions.id'
  const columns = [
    'sessions.id AS session_id',
    'sessions.agent_id AS agent_id',
    selectLegacySessionColumn(schemaInfo, 'accessible_paths', 'session_accessible_paths', 'NULL'),
    selectLegacyAgentColumn(schemaInfo, 'accessible_paths', 'agent_accessible_paths', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'sort_order', 'sort_order', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'created_at', 'created_at', 'NULL'),
    selectLegacySessionColumn(schemaInfo, 'updated_at', 'updated_at', 'NULL')
  ]

  return (await db.all(
    sql.raw(
      `SELECT ${columns.join(', ')}
       FROM agents_legacy.sessions AS sessions
       INNER JOIN agents_legacy.agents AS agents ON agents.id = sessions.agent_id
       ORDER BY ${sortOrder} ASC, ${createdAt} ASC, sessions.id ASC`
    )
  )) as LegacySessionWorkspaceRow[]
}

function extractPrimaryWorkspacePath(rawPaths: string | null, source: 'session' | 'agent'): string | null {
  if (!rawPaths?.trim()) {
    return null
  }

  let parsed: unknown = rawPaths
  try {
    parsed = JSON.parse(rawPaths)
  } catch {
    // Some early local builds wrote a plain path string; accept it.
  }

  const candidate = Array.isArray(parsed) ? parsed[0] : typeof parsed === 'string' ? parsed : null

  if (typeof candidate !== 'string') {
    return null
  }

  const trimmed = candidate?.trim()
  if (!trimmed) {
    return null
  }
  if (!path.isAbsolute(trimmed)) {
    logger.warn('Skipping legacy primary workspace because path is not absolute', { source, path: trimmed })
    return null
  }
  return path.normalize(trimmed)
}

function workspaceNameFromPath(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

function legacyTimestampToMs(value: string | number | null, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function defaultWorkspacePathForSession(agentWorkspacesDir: string, sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || uuidv4()
  return path.join(agentWorkspacesDir, `session-${safeSessionId}`)
}

function countExpectedSessionWorkspacePaths(derived: DerivedSessionWorkspaces): Map<string, number> {
  const workspacePathById = new Map(derived.workspaces.map((workspace) => [workspace.id, workspace.path]))
  const counts = new Map<string, number>()
  for (const mapping of derived.mappings) {
    const workspacePath = workspacePathById.get(mapping.workspaceId)
    if (!workspacePath) continue
    counts.set(workspacePath, (counts.get(workspacePath) ?? 0) + 1)
  }
  return counts
}

async function collectLegacySessionWorkspaces(
  ctx: MigrationContext,
  schemaInfo: AgentsSchemaInfo
): Promise<DerivedSessionWorkspaces> {
  const rows = await selectLegacySessionWorkspaceRows(ctx.db, schemaInfo)
  const byPath = new Map<string, DerivedWorkspace>()
  const mappings: DerivedSessionWorkspaceMap[] = []
  const now = Date.now()
  const agentWorkspacesDir = ctx.paths.agentWorkspacesDir

  for (const row of rows) {
    const workspacePath =
      extractPrimaryWorkspacePath(row.session_accessible_paths, 'session') ??
      extractPrimaryWorkspacePath(row.agent_accessible_paths, 'agent') ??
      defaultWorkspacePathForSession(agentWorkspacesDir, row.session_id)

    let workspace = byPath.get(workspacePath)
    if (!workspace) {
      const createdAt = legacyTimestampToMs(row.created_at, now)
      workspace = {
        id: uuidv4(),
        name: workspaceNameFromPath(workspacePath),
        path: workspacePath,
        orderKey: '',
        createdAt,
        updatedAt: legacyTimestampToMs(row.updated_at, createdAt)
      }
      byPath.set(workspacePath, workspace)
    }

    mappings.push({ sessionId: row.session_id, workspaceId: workspace.id })
  }

  const workspaces = Array.from(byPath.values())
  const orderKeys = generateOrderKeySequence(workspaces.length)
  for (let i = 0; i < workspaces.length; i++) {
    workspaces[i].orderKey = orderKeys[i]
  }

  return { workspaces, mappings }
}

async function stageSessionWorkspaces(ctx: MigrationContext, schemaInfo: AgentsSchemaInfo): Promise<number> {
  const db = ctx.db
  await db.run(
    sql.raw('CREATE TEMP TABLE IF NOT EXISTS session_workspace_map (session_id TEXT PRIMARY KEY, workspace_id TEXT)')
  )
  await db.run(sql.raw('DELETE FROM session_workspace_map'))

  const derived = await collectLegacySessionWorkspaces(ctx, schemaInfo)
  for (const workspace of derived.workspaces) {
    await db.run(
      sql`INSERT INTO agent_workspace (id, name, path, order_key, created_at, updated_at)
          VALUES (${workspace.id}, ${workspace.name}, ${workspace.path}, ${workspace.orderKey}, ${workspace.createdAt}, ${workspace.updatedAt})`
    )
  }
  for (const mapping of derived.mappings) {
    await db.run(
      sql`INSERT INTO session_workspace_map (session_id, workspace_id) VALUES (${mapping.sessionId}, ${mapping.workspaceId})`
    )
  }

  logger.info('Staged legacy session workspaces', {
    workspaces: derived.workspaces.length,
    mappedSessions: derived.mappings.length
  })
  return derived.workspaces.length
}

// ── Integrated post-copy shape transforms ────────────────────────────
//
// Exported as named helpers so they are unit-testable without constructing
// a full migrator / MigrationContext. `execute()` calls them inside the
// copy BEGIN/COMMIT block — failures roll back the entire import via
// SQLite ROLLBACK rather than leaving rows in an intermediate sentinel
// state. No silent post-hook semantics.

export interface BlocksToPartsTransformResult {
  totalMessages: number
  messagesConverted: number
  messagesSkipped: number
  errors: Array<{ rowId: string; error: string }>
}

/**
 * Convert `agent_session_message.content` from the legacy
 * `{ blocks: [...] }` shape into the current `{ data: { parts: [...] } }`
 * shape by reusing the same `transformBlocksToParts` converter regular
 * chat messages go through. Rows whose content has no legacy `blocks`
 * are skipped, so re-running is idempotent.
 */
export async function transformAgentBlocksToParts(db: DbType): Promise<BlocksToPartsTransformResult> {
  const result: BlocksToPartsTransformResult = {
    totalMessages: 0,
    messagesConverted: 0,
    messagesSkipped: 0,
    errors: []
  }

  const rows = await db.select().from(agentSessionMessageTable).orderBy(asc(agentSessionMessageTable.createdAt))
  result.totalMessages = rows.length
  logger.info(`Blocks→Parts: scanning ${rows.length} agent_session_message rows`)

  for (const row of rows) {
    if (!row?.content) {
      result.messagesSkipped++
      continue
    }

    try {
      // Legacy rows copied via raw INSERT...SELECT arrive as strings even
      // though Drizzle types the column as JSON — normalise both paths.
      const parsed = typeof row.content === 'string' ? JSON.parse(row.content) : row.content
      const blocks = parsed?.blocks ?? []
      const message = parsed?.message

      if (!message || blocks.length === 0) {
        result.messagesSkipped++
        continue
      }

      const { parts } = transformBlocksToParts(blocks)
      message.data = { ...message.data, parts }
      // Transient statuses (sending/pending/searching/processing) in persisted
      // rows are interrupted streams — collapse them to 'error' so the renderer
      // doesn't paint them as still-streaming. Parts are already in terminal
      // states after transformBlocksToParts.
      message.status = normalizeStatus(message.status)
      message.blocks = []
      parsed.blocks = []

      await db.update(agentSessionMessageTable).set({ content: parsed }).where(eq(agentSessionMessageTable.id, row.id))
      result.messagesConverted++
    } catch (error) {
      result.errors.push({ rowId: row.id, error: error instanceof Error ? error.message : String(error) })
      logger.warn(`Failed to transform agent_session_message ${row.id}`, { error })
    }
  }

  logger.info(
    `Blocks→Parts complete: ${result.messagesConverted} converted, ${result.messagesSkipped} skipped, ${result.errors.length} errors`
  )
  return result
}

/**
 * Replace `''` placeholder orderKeys (set by INSERT...SELECT) with real
 * fractional-indexing keys, ordered by the source `sort_order`. Joins target
 * rows to `agents_legacy.{agents,sessions}` so this MUST run while the source
 * DB is attached AND before remapAgentPrefixIds rewrites target ids.
 *
 * Sessions are scoped per agentId.
 */
export async function backfillAgentOrderKeys(db: DbType): Promise<void> {
  type Row = { id: string }

  const agents = (await db.all(
    sql.raw(
      `SELECT a.id AS id FROM agent a
       LEFT JOIN agents_legacy.agents s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  )) as Row[]
  if (agents.length > 0) {
    const keys = generateOrderKeySequence(agents.length)
    for (let i = 0; i < agents.length; i++) {
      await db.run(sql`UPDATE agent SET order_key = ${keys[i]} WHERE id = ${agents[i].id}`)
    }
    logger.info(`Backfilled ${agents.length} agent order keys`)
  }

  const sessions = (await db.all(
    sql.raw(
      `SELECT a.id AS id, a.agent_id AS agent_id FROM agent_session a
       LEFT JOIN agents_legacy.sessions s ON a.id = s.id
       WHERE a.order_key = ''
       ORDER BY a.agent_id ASC, COALESCE(s.sort_order, 0) ASC, a.id ASC`
    )
  )) as Array<Row & { agent_id: string }>
  if (sessions.length === 0) return

  // Group by agentId and assign keys per group.
  const buckets = new Map<string, Row[]>()
  for (const row of sessions) {
    const list = buckets.get(row.agent_id) ?? []
    list.push({ id: row.id })
    buckets.set(row.agent_id, list)
  }
  for (const [, group] of buckets) {
    const keys = generateOrderKeySequence(group.length)
    for (let i = 0; i < group.length; i++) {
      await db.run(sql`UPDATE agent_session SET order_key = ${keys[i]} WHERE id = ${group[i].id}`)
    }
  }
  logger.info(`Backfilled ${sessions.length} session order keys across ${buckets.size} agents`)
}
