# Data Migration System

This directory contains the v2 data migration implementation.

## Documentation

- **Migration Guide**: [docs/references/data/v2-migration-guide.md](../../../../../docs/references/data/v2-migration-guide.md)

## Directory Structure

```
src/main/data/migration/v2/
├── core/              # MigrationEngine, MigrationContext, MigrationPaths
├── migrators/         # Domain-specific migrators
│   └── mappings/      # Mapping definitions
├── utils/             # ReduxStateReader, DexieFileReader, JSONStreamReader, LegacyHomeConfigReader
├── window/            # IPC handlers, window manager
└── index.ts           # Public exports
```

## Path Safety — Use `MigrationPaths` (Strict Requirement)

> **⚠️ WARNING: Not using predefined paths may cause user data loss.**
>
> v1 users may have configured a custom userData directory via
> `~/.cherrystudio/config/config.json`. If migration code calls
> `app.getPath('userData')` or `new Store()` directly, on the first v2
> launch it will read from the Electron default path instead of the
> user's actual data directory — causing migration to be silently
> skipped or to migrate empty data, **making user data appear lost**.

All migration code **MUST** use the pre-computed path constants from
`MigrationPaths`. **NEVER** call `app.getPath()` directly or construct
paths with `path.join()` from scratch inside migration code.

| Correct ✅ | Wrong ❌ |
|-----------|---------|
| `ctx.paths.userData` | `app.getPath('userData')` |
| `ctx.paths.databaseFile` | `path.join(app.getPath('userData'), 'cherrystudio.sqlite')` |
| `ctx.paths.knowledgeBaseDir` | `path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')` |
| `ctx.paths.legacyConfigFile` | `path.join(os.homedir(), '.cherrystudio', 'config', 'config.json')` |
| `new Store({ cwd: ctx.paths.userData })` | `new Store()` |

`MigrationPaths` is resolved once at the migration gate entry by
`resolveMigrationPaths()` (including v1 legacy userData detection),
then passed through `MigrationContext.paths` to all migrators. If you
need a new path, add it to the `MigrationPaths` interface — do not
construct it inline.

## Quick Reference

### Creating a New Migrator

1. Extend `BaseMigrator` in `migrators/`
2. Implement `prepare`, `execute`, `validate` methods
3. Register in `migrators/index.ts`
4. Use `ctx.paths` for all filesystem paths — **NEVER** call `app.getPath()` directly

### Key Contracts

- `prepare(ctx)`: Dry-run checks, return counts
- `execute(ctx)`: Perform inserts, report progress
- `validate(ctx)`: Verify counts and integrity

### Foreign Keys Caveat

libsql defaults to `foreign_keys = ON` (compiled with `SQLITE_DEFAULT_FOREIGN_KEYS=1`).
`@libsql/client` creates new connections after each `transaction()`, resetting PRAGMAs.
For bulk inserts with self-referencing FKs, run `PRAGMA foreign_keys = OFF` before **each**
`db.transaction()` call. See the [migration guide](../../../../../docs/references/data/v2-migration-guide.md) for details.
