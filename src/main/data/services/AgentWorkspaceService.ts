import { application } from '@application'
import { type AgentWorkspaceRow, agentWorkspaceTable, type AgentWorkspaceType } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentWorkspaceEntity, UpdateAgentWorkspaceDto } from '@shared/data/api/schemas/agentWorkspaces'
import { and, asc, eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentWorkspaceService')

type AgentWorkspaceTx = Pick<DbType, 'select' | 'insert'>
type AgentWorkspaceDeleteTx = Pick<DbType, 'delete'>
type AgentWorkspaceLookupOptions = { includeSystem?: boolean }
type PreparedSystemAgentWorkspace = {
  id: string
  name: string
  path: string
  type: Extract<AgentWorkspaceType, 'system'>
}

export function rowToAgentWorkspace(row: AgentWorkspaceRow): AgentWorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function normalizeAgentWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ path: ['AgentWorkspace path is required'] })
  }
  if (!path.isAbsolute(trimmed)) {
    throw DataApiErrorFactory.validation({ path: ['AgentWorkspace path must be absolute'] })
  }
  return path.normalize(trimmed)
}

function defaultAgentWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

function normalizeAgentWorkspaceName(rawName: string): string {
  const trimmed = rawName.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ name: ['AgentWorkspace name is required'] })
  }
  return trimmed
}

function ensureAgentWorkspaceDirectory(workspacePath: string): void {
  if (fs.existsSync(workspacePath)) {
    const stats = fs.statSync(workspacePath)
    if (!stats.isDirectory()) {
      throw DataApiErrorFactory.validation({ path: ['AgentWorkspace path must be a directory'] })
    }
    return
  }

  try {
    fs.mkdirSync(workspacePath, { recursive: true })
  } catch (error) {
    logger.error('Failed to create workspace directory', {
      path: workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatSystemAgentWorkspaceDate(now: Date): { datePart: string; timePart: string; label: string } {
  const datePart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const timePart = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const label = `${datePart} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return { datePart, timePart, label }
}

function sanitizeSessionIdSegment(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (sanitized || uuidv4()).slice(0, 8)
}

export class AgentWorkspaceService {
  async list(options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(agentWorkspaceTable)
      .where(options.includeSystem ? undefined : eq(agentWorkspaceTable.type, 'user'))
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
    return rows.map(rowToAgentWorkspace)
  }

  async getById(id: string, options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id, options)
    return rowToAgentWorkspace(row)
  }

  async getByIdTx(
    tx: AgentWorkspaceTx,
    id: string,
    options: AgentWorkspaceLookupOptions = {}
  ): Promise<AgentWorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id, options)
    return rowToAgentWorkspace(row)
  }

  async getRowByIdTx(
    tx: AgentWorkspaceTx,
    id: string,
    options: AgentWorkspaceLookupOptions = {}
  ): Promise<AgentWorkspaceRow> {
    const predicate = options.includeSystem
      ? eq(agentWorkspaceTable.id, id)
      : and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, 'user'))
    const [row] = await tx.select().from(agentWorkspaceTable).where(predicate).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('AgentWorkspace', id)
    return row
  }

  async deleteByIdTx(tx: AgentWorkspaceDeleteTx, id: string): Promise<void> {
    const [row] = await tx
      .delete(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
      .returning({ id: agentWorkspaceTable.id })
    if (!row) throw DataApiErrorFactory.notFound('AgentWorkspace', id)
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeAgentWorkspacePath(rawPath)
    ensureAgentWorkspaceDirectory(workspacePath)

    const row = await withSqliteErrors(
      () =>
        application
          .get('DbService')
          .withWriteTx((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('AgentWorkspace', workspacePath),
        unique: () =>
          DataApiErrorFactory.conflict(`AgentWorkspace path '${workspacePath}' already exists`, 'AgentWorkspace')
      }
    )

    return rowToAgentWorkspace(row)
  }

  async findOrCreateByPathTx(
    tx: AgentWorkspaceTx,

    rawPath: string,

    options: { name?: string } = {}
  ): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeAgentWorkspacePath(rawPath)
    ensureAgentWorkspaceDirectory(workspacePath)
    const row = await withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('AgentWorkspace', workspacePath),
      unique: () =>
        DataApiErrorFactory.conflict(`AgentWorkspace path '${workspacePath}' already exists`, 'AgentWorkspace')
    })
    return rowToAgentWorkspace(row)
  }

  async createDefaultAgentWorkspace(): Promise<AgentWorkspaceEntity> {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    return await this.findOrCreateByPath(workspacePath)
  }

  async createDefaultAgentWorkspaceTx(tx: AgentWorkspaceTx): Promise<AgentWorkspaceEntity> {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    return await this.findOrCreateByPathTx(tx, workspacePath)
  }

  prepareSystemAgentWorkspaceForSession(sessionId: string, now = new Date()): PreparedSystemAgentWorkspace {
    const { datePart, timePart, label } = formatSystemAgentWorkspaceDate(now)
    const workspacePath = path.join(
      application.getPath('feature.agents.workspaces'),
      'system',
      datePart,
      `${timePart}-${sanitizeSessionIdSegment(sessionId)}`
    )
    ensureAgentWorkspaceDirectory(workspacePath)
    return {
      id: uuidv4(),
      name: `No project ${label}`,
      path: workspacePath,
      type: 'system'
    }
  }

  async createPreparedSystemAgentWorkspaceTx(
    tx: AgentWorkspaceTx,
    prepared: PreparedSystemAgentWorkspace
  ): Promise<AgentWorkspaceEntity> {
    const row = await this.insertAgentWorkspaceRowTx(tx, prepared)
    return rowToAgentWorkspace(row)
  }

  async createSystemAgentWorkspaceForSession(sessionId: string, now = new Date()): Promise<AgentWorkspaceEntity> {
    const prepared = this.prepareSystemAgentWorkspaceForSession(sessionId, now)
    try {
      const dbService = application.get('DbService')
      return await withSqliteErrors(
        () => dbService.withWriteTx((tx) => this.createPreparedSystemAgentWorkspaceTx(tx, prepared)),
        {
          ...defaultHandlersFor('AgentWorkspace', prepared.id),
          unique: () =>
            DataApiErrorFactory.conflict(`AgentWorkspace path '${prepared.path}' already exists`, 'AgentWorkspace')
        }
      )
    } catch (error) {
      this.deletePreparedSystemAgentWorkspaceDirectory(prepared)
      throw error
    }
  }

  assertSystemAgentWorkspacePath(workspacePath: string): void {
    const systemRoot = path.resolve(application.getPath('feature.agents.workspaces'), 'system')
    const targetPath = path.resolve(workspacePath)
    const relative = path.relative(systemRoot, targetPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw DataApiErrorFactory.validation({ path: ['System workspace path is outside the system workspace root'] })
    }
  }

  deleteSystemAgentWorkspaceDirectory(workspacePath: string): void {
    this.assertSystemAgentWorkspacePath(workspacePath)
    fs.rmSync(workspacePath, { recursive: true, force: true })
  }

  deleteSystemAgentWorkspaceDirectoryAfterCommit(workspacePath: string): void {
    try {
      this.deleteSystemAgentWorkspaceDirectory(workspacePath)
    } catch (error) {
      logger.error('Failed to delete system workspace directory after database delete', {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  deletePreparedSystemAgentWorkspaceDirectory(prepared: PreparedSystemAgentWorkspace): void {
    try {
      this.deleteSystemAgentWorkspaceDirectory(prepared.path)
    } catch (error) {
      logger.warn('Failed to clean prepared system workspace directory', {
        path: prepared.path,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async update(id: string, dto: UpdateAgentWorkspaceDto): Promise<AgentWorkspaceEntity> {
    const db = application.get('DbService').getDb()
    await this.getRowByIdTx(db, id)
    const [row] = await withSqliteErrors(
      () =>
        db
          .update(agentWorkspaceTable)
          .set({ name: normalizeAgentWorkspaceName(dto.name) })
          .where(eq(agentWorkspaceTable.id, id))
          .returning(),
      defaultHandlersFor('AgentWorkspace', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('AgentWorkspace', id)
    return rowToAgentWorkspace(row)
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: AgentWorkspaceTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<AgentWorkspaceRow> {
    const [existing] = await tx

      .select()

      .from(agentWorkspaceTable)

      .where(and(eq(agentWorkspaceTable.path, workspacePath), eq(agentWorkspaceTable.type, 'user')))

      .limit(1)
    if (existing) return existing

    const id = uuidv4()
    const name = options.name?.trim() || defaultAgentWorkspaceName(workspacePath)
    return await this.insertAgentWorkspaceRowTx(tx, { id, name, path: workspacePath, type: 'user' })
  }

  private async insertAgentWorkspaceRowTx(
    tx: AgentWorkspaceTx,
    workspace: { id: string; name: string; path: string; type: AgentWorkspaceType }
  ): Promise<AgentWorkspaceRow> {
    return (await insertWithOrderKey(tx, agentWorkspaceTable, workspace, {
      pkColumn: agentWorkspaceTable.id,
      position: 'first'
    })) as AgentWorkspaceRow
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  async reorderTx(tx: AgentWorkspaceTx, id: string, anchor: OrderRequest): Promise<void> {
    const [target] = await tx
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
    if (!target) throw DataApiErrorFactory.notFound('AgentWorkspace', id)
    await applyMoves(tx, agentWorkspaceTable, [{ id, anchor }], {
      pkColumn: agentWorkspaceTable.id,
      scope: eq(agentWorkspaceTable.type, 'user')
    })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    const dbService = application.get('DbService')
    await dbService.withWriteTx((tx) =>
      applyMoves(tx, agentWorkspaceTable, moves, {
        pkColumn: agentWorkspaceTable.id,
        scope: eq(agentWorkspaceTable.type, 'user')
      })
    )
  }
}

export const agentWorkspaceService = new AgentWorkspaceService()
