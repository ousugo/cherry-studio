/**
 * Column helper utilities for Drizzle schemas
 *
 * USAGE RULES:
 * - DO NOT manually set id, createdAt, or updatedAt - they are auto-generated
 * - Use .returning() to get inserted/updated rows instead of re-querying
 * - See db/README.md for detailed field generation rules
 *
 * TIMESTAMP SEMANTICS:
 * - `createUpdateTimestamps.createdAt` / `.updatedAt` are DB-level NOT NULL.
 *   The `$defaultFn` / `$onUpdateFn` hooks fill them at insert/update time, so
 *   application code can still omit them in `.values({...})`.
 * - `createUpdateDeleteTimestamps.deletedAt` stays nullable by design: NULL
 *   encodes "not soft-deleted". Setting it to a timestamp marks the row as
 *   soft-deleted.
 */

import { integer, text } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

/**
 * UUID v4 primary key with auto-generation
 * Use for general purpose tables
 */
export const uuidPrimaryKey = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv4())

/**
 * UUID v7 primary key with auto-generation (time-ordered)
 * Use for tables with large datasets that benefit from sequential inserts
 */
export const uuidPrimaryKeyOrdered = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv7())

const createTimestamp = () => {
  return Date.now()
}

export const createUpdateTimestamps = {
  createdAt: integer().notNull().$defaultFn(createTimestamp),
  updatedAt: integer().notNull().$defaultFn(createTimestamp).$onUpdateFn(createTimestamp)
}

export const createUpdateDeleteTimestamps = {
  createdAt: integer().notNull().$defaultFn(createTimestamp),
  updatedAt: integer().notNull().$defaultFn(createTimestamp).$onUpdateFn(createTimestamp),
  deletedAt: integer()
}
