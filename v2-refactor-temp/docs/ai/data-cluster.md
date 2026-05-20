# Data Layer — Reviewer Cluster

## Scope

| Subpath | What changed |
|---|---|
| `src/main/data/db/schemas/` | Agent / session / workspace / agent-message tables restructured; `job.ts` deleted |
| `src/main/data/services/` | `SessionService.ts` + `WorkspaceService.ts` new; `AgentService.ts`, `AgentSessionMessageService.ts`, `MessageService.ts` heavy rewrites; `JobService.ts` + `JobScheduleService.ts` removed |
| `src/main/data/api/handlers/` | `sessions.ts` + `workspaces.ts` new; `jobs.ts` removed; `agents.ts` slimmed (~100 LOC); `messages.ts` extended; `assistants.ts` + `topics.ts` extended |
| `src/main/data/migration/v2/migrators/` | `AgentsMigrator.ts` + `AgentsDbMappings.ts` rewrites; `ChatMigrator.ts` parts conversion; `ProviderModelMigrator.ts` `adapterFamily` backfill |
| `packages/shared/data/types/` | `agentMessage.ts` + `agentSlashCommands.ts` + `uiParts.ts` new; `agent.ts` slimmed via Zod inference; `message.ts` heavy rewrite (parts model) |
| `packages/shared/data/api/schemas/` | `sessions.ts` + `workspaces.ts` new; `agents.ts` slimmed by 126 LOC; `messages.ts` + `assistants.ts` + `providers.ts` extended |

Total surface: ~94 files modified across `src/main/data/` and
`packages/shared/data/`.

## Intent

The AI pipeline refactor exposed three v1 data-layer constraints:

1. **Agent and Session conflated cognitive config.** Each v1 session
   carried its own copy of `mcps` / `allowedTools` / `configuration` /
   accessible paths. Two sessions of the same agent could drift, and
   the renderer had to chase both rows to render an agent profile.
2. **Workspace was a string column on agents.** A single
   `accessible_paths: string[]` field on each agent. Sessions inherited
   it. There was no row identity for "this directory" — renaming,
   reordering, or reusing a directory across agents meant duplicating
   the string.
3. **Agent session messages stored `blocks: MessageBlock[]`** — Cherry
   v1's custom block model. AI SDK v6 produces `UIMessage.parts`
   directly. Continuing to convert one to the other on every read /
   write meant maintaining a translation layer that has zero v2-side
   consumers.

The refactor:

- **Split.** `agent` keeps cognitive config; `agent_session` keeps
  per-session state + workspace binding. Sessions reference their agent
  by FK with `onDelete: 'set null'` so orphan sessions can still render.
- **Normalize.** `agent_workspace` is a separate table with unique
  `path` index. Sessions FK to workspaces, also `set null` on delete so
  removing a workspace doesn't cascade-delete sessions.
- **Parts.** `agent_session_message.content` stores
  `AgentPersistedMessage` (AI-SDK-native `parts`) directly. The
  `blocks` field is gone end-to-end; the migrator converts legacy rows
  in place.

See [Multi-model & data shape changes](#multi-model--data-shape-changes)
below for the multi-model + plan/small model split that motivated the
agent schema rewrite.

## Schema diff (production-shape)

### `agent` (rewritten — `src/main/data/db/schemas/agent.ts`)

```ts
export const agentTable = sqliteTable('agent', {
  id: uuidPrimaryKey(),
  type: text().notNull(),                                         // 'claude-code', future agent kinds
  name: text().notNull(),
  description: text().notNull().default(''),
  instructions: text().notNull(),

  // Multi-model: chat / plan / small as three separate FK columns to userModel.
  // Plan model = used for high-level planning when the agent supports it;
  // small model = used for cheap helper calls (compaction, summaries).
  model:      text().references(() => userModelTable.id, { onDelete: 'set null' }),
  planModel:  text().references(() => userModelTable.id, { onDelete: 'set null' }),
  smallModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),

  mcps:          text({ mode: 'json' }).$type<string[]>().notNull().default('[]'),
  allowedTools:  text({ mode: 'json' }).$type<string[]>().notNull().default('[]'),
  configuration: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default('{}'),
  ...orderKeyColumns,
  ...createUpdateDeleteTimestamps
})
```

Removed from this table (relative to v1): `accessible_paths`,
per-session config fields, `enableAutoTools`, model ids as strings.

`configuration` is intentionally `.loose()` (Zod passthrough) at the
schema layer — see `AgentConfigurationSchema` for the typed keys (avatar,
permission_mode, max_turns, scheduler_*, heartbeat_*, soul_enabled,
env_vars). Unknown extras are preserved across read/write so older
/newer app versions don't silently drop fields.

### `agent_session` (rewritten — `agentSession.ts`)

```ts
export const agentSessionTable = sqliteTable('agent_session', {
  id: uuidPrimaryKey(),
  agentId:     text().references(() => agentTable.id,     { onDelete: 'set null' }),
  workspaceId: text().references(() => workspaceTable.id, { onDelete: 'set null' }),
  name: text().notNull(),
  description: text().notNull().default(''),
  ...orderKeyColumns,
  ...createUpdateTimestamps
})
```

Removed (relative to v1): every cognitive-config field. The renderer
fetches them via `useAgent(session.agentId)`.

**Insert-only workspace.** `UpdateSessionDto` deliberately does not
include `workspaceId` — a running session can't be re-pointed at a new
directory. Migrated sessions may have `workspaceId === null`; newly
created sessions bind one (auto-derived from the most recent sibling, or
a default created on demand).

### `agent_workspace` (new — `workspace.ts`)

```ts
export const workspaceTable = sqliteTable('agent_workspace', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  path: text().notNull(),
  ...orderKeyColumns,
  ...createUpdateTimestamps
}, t => [uniqueIndex('agent_workspace_path_unique_idx').on(t.path), ...])
```

`path` is the unique key. `WorkspaceService.create` normalizes
(absolute + `path.normalize`), creates the directory if missing
(`fs.mkdirSync({ recursive: true })`), and validates it's not a file.

### `agent_session_message` (rewritten — `agentSessionMessage.ts`)

```ts
export const agentSessionMessageTable = sqliteTable('agent_session_message', {
  id: uuidPrimaryKeyOrdered(),
  sessionId: text().notNull().references(() => agentSessionTable.id, { onDelete: 'cascade' }),
  role: text().notNull(),
  content: text({ mode: 'json' }).$type<AgentPersistedMessage>().notNull(),
  // Claude Agent SDK resume token; null when the session never ran or was reset.
  agentSessionId: text(),
  metadata: text({ mode: 'json' }).$type<Record<string, unknown>>(),
  ...createUpdateTimestamps
})
```

`content` is now `AgentPersistedMessage` (parts model). The legacy
`blocks` column is gone. `agentSessionId` is the Claude Agent SDK's
resume token — written through the AI pipeline by the stream-manager's
PersistenceListener, used to resume an interrupted Claude Code session
without re-uploading the whole context.

### `agent_channel` + `agent_channel_task` (new — `agentChannel.ts`)

Channel adapters for Discord / Slack / Telegram / Feishu / WeChat / QQ.
`config` is JSON, `permissionMode` is constrained via `check` to the
Claude Agent SDK's permission modes, and `agent_channel_task` is the
join table to scheduled `agent_task` rows.

### `agent_task`, `agent_task_run_log`, `agent_global_skill`, `agent_skill`

Scheduled-task infrastructure that replaces v1's `job` table. Each
`agent_task` carries cron / interval / one-time scheduling plus a
prompt; `agent_task_run_log` stores per-run outputs. `agent_global_skill`
+ `agent_skill` model the (currently flat) "skill" catalog.

### `job` table — REMOVED

The v1 `job` / `job_schedule` tables and the entire
`JobService` / `JobScheduleService` / `jobs.ts` handler stack are gone.
Cherry's only consumer of jobs was the agent scheduler; agents now own
their schedule via `agent_task`. No DataApi `/jobs` endpoint exists in
v2.

## Service-layer changes

### New services

- **`SessionService.ts`** (188 LOC). Cursor-paginated list with order
  keys, transactional create that joins workspace (selects most recent
  sibling's workspace if none supplied, else creates a default), insert-
  only workspace binding.
- **`WorkspaceService.ts`** (164 LOC). CRUD + path normalization + dir
  creation + reorder. `createDefaultWorkspaceTx` is the auto-create path
  used when a session is created without a workspace.

### Heavy rewrites

- **`AgentService.ts`** (+241 LOC change). Foreign-keyed model fields
  expand into joined reads; cognitive config snapshot
  (`getAgentForRun(sessionId)`) consolidates fields the AI pipeline needs.
  See commit `f2229a881 refactor(agents): harden agent model field to
  UniqueModelId end-to-end`.
- **`AgentSessionMessageService.ts`** (+215 LOC). Cursor-paginated
  history (newest-first); persists `AgentPersistedMessage`; idempotent
  upsert keyed on `(sessionId, content.id)` so retried persistence
  doesn't double-insert.
- **`MessageService.ts`** (+390 LOC). Tree operations under the v2 parts
  model — `createUserMessageWithPlaceholders` (transactional), tree path
  reads, sibling groups, branch active-path tracking. Drops every
  `blocks` reference.

### `JobService` / `JobScheduleService` deleted

Both services + their tests removed. References across the repo are now
gone.

## DataApi handlers

| Endpoint | Status | Notes |
|---|---|---|
| `GET/POST /sessions`, `/sessions/:id` | new | session CRUD |
| `GET /sessions/:id/messages` | new | cursor-paginated |
| `GET/POST /workspaces`, `/workspaces/:id`, `PATCH/DELETE` | new | workspace CRUD + reorder |
| `/agents/*` | slimmed | ~100 LOC removed; legacy order endpoints gone |
| `/jobs/*` | REMOVED | scheduler now lives under agent tasks |
| `/messages/*` | extended | parts read/write, tree path, sibling helpers |
| `/topics/*` | extended | branch-aware active-node tracking |

## Migration (v1 → v2)

### `AgentsMigrator`

Reads the legacy standalone `agents.db` and folds it into the main
SQLite database. Source tables → targets:

| Source | Target |
|---|---|
| `agents` | `agent` (+ join: model id → `user_model`) |
| `sessions` | `agent_session` |
| `sessions.accessible_paths[0]` | `agent_workspace` (one workspace per session, first valid path) |
| `session_messages` | `agent_session_message` (with `transformBlocksToParts`) |
| `skills` | `agent_global_skill` |
| `agent_skills` | `agent_skill` |
| `scheduled_tasks` | `agent_task` |
| `task_run_logs` | `agent_task_run_log` |
| `channels` | `agent_channel` |
| `channel_task_subscriptions` | `agent_channel_task` |

Key points:

- **First workspace wins.** Only `accessible_paths[0]` is migrated to a
  workspace row. Additional paths are not preserved. See
  [`2026-05-19-agent-session-primary-workspace.md`](../breaking-changes/2026-05-19-agent-session-primary-workspace.md).
- **`blocks` → `parts`** for legacy session messages, via the same
  `transformBlocksToParts` that `ChatMigrator` uses for the chat tree.
- **Defensive default backfill.** `notNullCol(name, defaultExpr)` in
  `AgentsDbMappings` covers the case where legacy rows have NULL in
  columns that are `NOT NULL` in v2; a plain `SELECT col` would
  otherwise hit `SQLITE_CONSTRAINT_NOTNULL`.
- **Order keys.** `generateOrderKeySequence` synthesizes
  fractional-indexing order keys for every migrated row so the v2
  reorder UX works on migrated data.

### `ChatMigrator`

The `transformBlocksToParts` helper is shared with `AgentsMigrator`.
Both produce `CherryMessagePart[]`; no legacy `blocks` survives the
migration.

### `ProviderModelMigrator`

Backfills `adapterFamily` per endpoint config. See
[`adapter-family.md`](./adapter-family.md).

## Shared types & API schemas

### `packages/shared/data/types/agentMessage.ts` (new)

The `AgentPersistedMessage` shape stored on `agent_session_message.content`.

### `packages/shared/data/types/uiParts.ts` (new)

Lifted the UI part type definitions out of `message.ts` so the agents
domain can consume them without taking the full chat-message dependency
graph.

### `packages/shared/data/types/agent.ts` (slimmed)

Replaced hand-written types with Zod-inferred types from `api/schemas/agents.ts`.

### `packages/shared/data/types/message.ts` (rewritten)

Removed the legacy `blocks` field and the type machinery built around
it. `CherryMessagePart`, `CherryUIMessage`, `Message`,
`AssistantMessageStatus` are the v2 vocabulary.

### `packages/shared/data/api/schemas/sessions.ts` (new)

Entity + DTO schemas for sessions. `UpdateSessionSchema` deliberately
omits `workspaceId` to enforce insert-only binding.

### `packages/shared/data/api/schemas/workspaces.ts` (new)

Entity + DTO schemas for workspaces. Path validation matches
`WorkspaceService.normalizeWorkspacePath`.

### `packages/shared/data/api/schemas/agents.ts` (slimmed)

`AgentEntity` derived from the new schema. The 126-LOC reduction comes
from dropping per-session fields that moved to `sessions.ts`.

## Multi-model & data shape changes

Three places where the data model now distinguishes models:

1. **Agent.** Three FKs to `userModel`: `model` (default chat),
   `planModel` (planning), `smallModel` (helper calls). Migration maps
   v1's single `model_id` to all three (the renderer overrides
   plan / small as the user configures them).
2. **Message.** `modelId: UniqueModelId` (`providerId::modelId`) is the
   v2 model identifier; v1's `provider: string` + `model_id: string`
   merge into this. Persistent chats already used UniqueModelId; agent
   messages now use it too.
3. **Multi-model assistant turn.** `siblings_group_id` (already on the
   message tree) groups parallel assistant replies. The migrator
   preserves existing sibling groups; the stream-manager's persistent
   provider allocates new ones for fresh multi-model turns.

## Invariants reviewers should check

1. **Cognitive config lives on the agent, not the session.** A
   `UpdateSessionDto` adding `model`/`mcps`/`allowedTools` is wrong —
   those changes go through `UpdateAgentDto`.
2. **Workspace is insert-only on sessions.** No code path should call
   `sessionService.update(id, { workspaceId: ... })`. The schema rejects
   this; reviewer should also catch any handler / hook that bypasses the
   schema.
3. **Workspace deletion does not cascade to sessions.** FK is
   `set null` — orphan sessions surface a "workspace removed" warning
   instead of disappearing.
4. **`blocks` field is gone.** Any newly added code that reads
   `data.blocks` or `message.blocks` is wrong. The migration is the only
   place legacy `blocks` ever appears, and it converts to `parts`.
5. **`agent_session_id` (Claude SDK resume token) is null until first
   run.** Persistence writes it; reads must accept null.
6. **Tool IDs are `${serverName}__${toolName}`** (double underscore) in
   the `allowedTools` JSON arrays. `mcps` is `string[]` of server ids.
7. **`/jobs/*` API endpoint is gone.** Anything that tries to read
   schedules from there is dead — go through `/agents/:id/tasks`.

## Validation

- `services/__tests__/AgentService.test.ts`, `AgentSessionService.test.ts`,
  `WorkspaceService.test.ts`, `SessionService.test.ts`,
  `MessageService.test.ts`, `AgentChannelService.test.ts`,
  `AgentTaskService.test.ts`.
- `migration/v2/migrators/__tests__/AgentsMigrator.test.ts`,
  `AgentsMigrator.transforms.test.ts`,
  `mappings/__tests__/AgentsDbMappings.test.ts`,
  `remapAgentPrefixIds.test.ts`.
- `migration/v2/migrators/__tests__/ChatMigrator.test.ts` for
  `transformBlocksToParts`.
- `packages/shared/data/api/schemas/__tests__/agents.test.ts`,
  `workspaces.test.ts`.
- `api/handlers/__tests__/agents.test.ts`,
  `temporaryChats.test.ts`, `temporaryChats.integration.test.ts`.

## Follow-ups (out of scope)

- `agents.db` lives as a separate SQLite file pre-migration. After v2
  GA the legacy file should be deleted; for now the migrator just reads
  it.
- The `_skills` tables (`agent_global_skill`, `agent_skill`) currently
  mirror the v1 catalog 1:1. A future "skill registry" pass may
  re-shape both.
- `MessageService.ts` is at 1163 LOC — splitting into tree / sibling /
  branch helpers is queued for a follow-up.
