import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

export const workspaceTable = sqliteTable(
  'workspace',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    path: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [uniqueIndex('workspace_path_unique_idx').on(t.path), orderKeyIndex('workspace')(t)]
)

export type WorkspaceRow = typeof workspaceTable.$inferSelect
export type InsertWorkspaceRow = typeof workspaceTable.$inferInsert
