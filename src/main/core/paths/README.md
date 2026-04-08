# Paths Module

The single source of truth for every filesystem path used by the Electron
main process. Replaces ad-hoc `app.getPath()` / `os.homedir()` / `path.join`
constructions scattered throughout the codebase.

Every path the main process needs is registered once in `pathRegistry.ts`
(inside the `buildPathRegistry()` function) and accessed exclusively through
`application.getPath()`. The registry is **frozen at `Application.bootstrap()`
time** — calling `application.getPath(...)` before bootstrap throws.

## Quick Start

```ts
import { application } from '@main/core/application'

// Get a registered directory:
const filesDir = application.getPath('feature.files.data')
//=> '/Users/alice/Library/Application Support/CherryStudio/Data/Files'

// Get a file inside a registered directory:
const avatar = application.getPath('feature.files.data', 'avatar.png')
//=> '/Users/alice/Library/Application Support/CherryStudio/Data/Files/avatar.png'
```

`PathKey` is a string-literal union derived from `PATHS`, so invalid keys are
rejected at compile time:

```ts
application.getPath('invalid.key')
// TS2345: Argument of type '"invalid.key"' is not assignable to parameter
//         of type 'PathKey'.
```

## Module Layout

```
src/main/core/paths/
├── constants.ts          Earliest path constants (CHERRY_HOME, BOOT_CONFIG_PATH,
│                         LOGS_DIR). Consumed directly by LoggerService and
│                         BootConfigService — both run before the registry exists.
├── pathRegistry.ts       The `buildPathRegistry()` function (called once from
│                         Application.bootstrap()) plus the `PathKey` / `PathMap`
│                         types. Constrained by ESLint data-schema-key/valid-key.
├── index.ts              Public entry point. Re-exports `PathKey` and `PathMap`
│                         types only. `buildPathRegistry` is intentionally NOT
│                         re-exported — Application.ts imports it via the deeper
│                         alias `@main/core/paths/pathRegistry`.
└── README.md             This file.
```

The `paths/` module exports only **types** (`PathKey`, `PathMap`). The path
**values** are produced by `buildPathRegistry()` and held privately by
`Application.ts`. The lookup/validation logic lives on `Application.getPath`.
Consumers must go through `application.getPath(...)` rather than constructing
paths themselves.

## Top-Level Namespaces

There are five top-level namespaces. Each tells you something about
**ownership** and **lifecycle**:

| Namespace | Owns | Examples |
|-----------|------|----------|
| `cherry.*` | Generic infrastructure under `~/.cherrystudio` shared across multiple features | `cherry.home`, `cherry.bin`, `cherry.config` |
| `sys.*` | Operating-system directories returned by Electron's `app.getPath()` | `sys.home`, `sys.temp`, `sys.downloads` |
| `app.*` | The Electron application itself: install dir, resources, userData, database, logs, shared temp root | `app.exe_file`, `app.userdata`, `app.database.file`, `app.temp` |
| `feature.*` | Cherry-owned feature data, regardless of physical location | `feature.files.data`, `feature.mcp.oauth`, `feature.backup.temp` |
| `external.*` | Third-party tool paths Cherry integrates with (Cherry is reader/writer, NOT owner) | `external.openclaw.config` |

There is **no** standalone `temp.*` namespace. Each feature owns its own temp
directory at `feature.<name>.temp`. The shared physical root is `app.temp`.

The boundary between `feature.*` and `external.*` is **ownership**:

- `feature.*` — Cherry creates, manages, and may delete on uninstall.
- `external.*` — A third party owns the directory; Cherry only reads/writes.
  Cherry MUST NOT delete `external.*` directories on uninstall or reset.

## Key Naming Convention

Path keys follow the same convention as preference keys, enforced at lint time
by `data-schema-key/valid-key`:

```
/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
```

- At least **2 segments** separated by `.`
- Each segment: lowercase letters, digits, and underscores
- Each segment must **start with a letter**
- Multi-word segments use `snake_case` (e.g. `crash_dumps`, `lan_transfer`)

### File vs Directory Naming

If a key refers to a **file** (not a directory), the key MUST clearly say so:

| Style | When to use | Example |
|-------|-------------|---------|
| `_file` suffix | Standalone file with no related sibling keys | `app.exe_file` → `/path/to/CherryStudio.exe` |
| `.file` last segment | File inside a namespace that has sibling members | `app.database.file` → `{userData}/cherrystudio.sqlite` (sibling: `app.database.migrations`) |

If the key refers to a **directory**, do NOT use `_file` or `.file` —
directories are the default.

## The `.` Separator: Semantic, Not Always Physical

The `.` represents a **namespace / semantic group**. It usually — but not
always — corresponds to filesystem nesting.

| Type | Example |
|------|---------|
| **Aligned** (key matches filesystem) | `cherry.bin` → `~/.cherrystudio/bin` |
| **Aligned** | `app.userdata.data` → `{userData}/Data` |
| **Aligned** | `feature.ovms.ovms` → `~/.cherrystudio/ovms/ovms` |
| **Not aligned** | `feature.mcp.oauth` → `~/.cherrystudio/config/mcp/oauth` (semantically grouped under `feature.mcp.*` but lives under `config/`) |
| **Not aligned** | `feature.mcp.workspace` → `{userData}/Data/Workspace` (same `feature.mcp.*` namespace as `~/.cherrystudio/mcp` but completely different physical tree) |
| **Not aligned** | `feature.agents.skills.temp` → `{app.temp}/skill-install` (sibling `feature.agents.skills` lives in `~/.cherrystudio/skills`) |
| **Not aligned** | `app.exe_file` → the .exe lives in `app.install`, not in any `app/exe/` dir |
| **Not aligned** | `app.logs` → `app.getPath('logs')` returns a platform-specific location (e.g. `~/Library/Logs/<App>/` on macOS) |

**Consumers MUST NOT** assume `a.b.c` is a filesystem sub-path of `a.b`. When
in doubt, consult the `PATHS` object directly.

## Adding a New Path Key

1. **Pick the right namespace** based on ownership (see the namespace table).
2. **Open `pathRegistry.ts`** and add the entry to the `PATHS` object literal
   in the appropriate section (each section is marked with a `// A.` / `// B.`
   header comment).
3. **Reuse a hoisted intermediate variable** if the path is a sub-directory of
   one already declared (e.g. `appUserDataData`, `appTemp`). Don't repeat
   `path.join` chains.
4. **Pick the right key shape**:
   - Directory? Just use the dotted key (no suffix).
   - Standalone file? Use `_file` suffix.
   - File inside a namespace with siblings? Use `.file` last segment.
5. **Run `pnpm lint`** — the ESLint rule will flag any naming-format violations.
6. **No tests required for the data itself** — the registry is data-only; the
   validation logic lives on `Application.getPath` and is already tested.

### Example: adding `feature.foo.config`

```ts
// In pathRegistry.ts, under the "// D. feature.* —" section:

  // -- Foo feature --
  'feature.foo.config': path.join(appUserDataData, 'Foo'),
```

## Using `getPath` in Services

Path lookup happens **only** via `Application.getPath`. Services access it via
the global `application` instance:

```ts
import { application } from '@main/core/application'

class MyService extends BaseService {
  async doSomething() {
    const dir = application.getPath('feature.files.data')
    const file = application.getPath('feature.files.data', 'config.json')
    // ...
  }
}
```

The `paths/` module deliberately does **not** export a standalone `getPath`
function. This forces every consumer through `Application.getPath`, which:

- Centralizes the filename validation in one place.
- Makes the access pattern uniform with `application.get('ServiceName')` for
  lifecycle services.
- Lets tests mock `application.getPath` once instead of mocking a function
  imported from many places.

## The `filename` Parameter: Single Segment

The optional second argument to `getPath` is a **single relative filename
segment**:

```ts
application.getPath('feature.files.data', 'avatar.png')   // ✅ recommended
application.getPath('feature.files.data', '/abs/path')    // ⚠️ logs warning, still joins
application.getPath('feature.files.data', '../escape')    // ⚠️ logs warning, still joins
application.getPath('feature.files.data', 'sub/file')     // ⚠️ logs warning, still joins
```

If the filename is absolute, contains `..`, or contains a path separator,
`Application.getPath` **logs a warning** via `loggerService` and joins the
path anyway. The warning is a developer hint that you may want to register a
new path key for the deeper path you're constructing.

For deeper sub-paths, register a new path key in `pathRegistry.ts` instead of
constructing them ad-hoc on the fly.

## Bootstrap Order

`buildPathRegistry()` reads `app.getPath('userData')` and other Electron
paths inside its function body. It is called exactly once, from
`Application.bootstrap()` at its entry point (after signal/quit handlers
are installed, before any lifecycle phase starts).

This means:

- `pathRegistry.ts` module evaluation has **no side effects** — importing
  the file is safe at any time.
- Any code that overrides Electron paths via `app.setPath(...)` MUST run
  **before** `application.bootstrap()` is invoked. The natural place is
  the top of `startApp()` in `src/main/index.ts`, eventually driven by
  `BootConfigService`.
- Calling `application.getPath(...)` before `bootstrap()` runs will throw
  with a clear error message. There is no fallback or lazy initialization.
- `LoggerService` and `BootConfigService` bypass this registry entirely:
  they need paths *before* the registry exists, so they read `LOGS_DIR`
  and `BOOT_CONFIG_PATH` directly from `paths/constants.ts`. This is by
  design, not a code smell — they form the bootstrap "zero layer" that
  the registry itself depends on.
- Runtime `app.setPath('userData', ...)` calls (e.g. via the legacy
  `App_SetAppDataPath` IPC handler) do **not** invalidate the frozen
  registry. The current v1 path-change flow always relaunches the app
  after such a call, so the divergence window never matters in practice;
  the IPC handler is marked TODO for v2 redesign.

## File-Level Constraint: No Other Object Literals in `pathRegistry.ts`

The ESLint rule `data-schema-key/valid-key` walks **every** `Property` AST
node in the file — including those inside function bodies. Defining a
helper object **anywhere in the file, including inside `buildPathRegistry()`'s
body**, would trip the rule. For example:

```ts
// ❌ DO NOT do this anywhere in pathRegistry.ts (top level OR inside the function):
const PLATFORM_OVERRIDES = {
  darwin: '...',
  win32: '...',
  linux: '...'
}
```

…would trip the rule on `darwin`, `win32`, and `linux` (none of which match
`namespace.sub.key_name`). Helper constants in `pathRegistry.ts` must be
`string` or `number` only. If you need a helper object, put it in a separate
file (e.g. a new `pathHelpers.ts`).

## Testing Patterns

`buildPathRegistry()` reads Electron `app.getPath()` at call time, so
naively calling it in tests can fail because the global Electron mock in
`tests/main.setup.ts` only stubs a subset of `app` methods.

There are two supported patterns depending on whether your test wants to
control the registry contents.

### Pattern 1 — Mock the registry, inject via test helper

If your test needs `application.getPath(...)` to return predictable values,
mock `@main/core/paths/pathRegistry` (NOT the public `@main/core/paths`
re-export) and inject the result via the `__setPathMapForTesting` helper:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/core/paths/pathRegistry', () => ({
  buildPathRegistry: () =>
    Object.freeze({
      'feature.files.data': '/mock/userData/Data/Files'
    })
}))

import { buildPathRegistry } from '@main/core/paths/pathRegistry'
import { Application } from '@main/core/application/Application'

describe('my service', () => {
  const app = Application.getInstance()
  app.__setPathMapForTesting(buildPathRegistry())

  it('uses the correct path', () => {
    expect(app.getPath('feature.files.data')).toBe('/mock/userData/Data/Files')
  })
})
```

Two things to note:

1. **Import `Application` from the file path**, not the directory. The global
   test setup mocks `@main/core/application` (the directory/index re-export);
   importing from `@main/core/application/Application` (the specific file)
   bypasses that mock and gives you the real class.
2. **Mock the deep path `@main/core/paths/pathRegistry`**, not the public
   `@main/core/paths` entry point. `Application.ts` imports `buildPathRegistry`
   via the deep path; mocking the public entry has no effect on
   `Application`'s view of the function.

### Pattern 2 — Bypass the throw without specific values

If your test doesn't care about specific path values but just needs `getPath`
to not throw (e.g. you're testing some other method that incidentally calls
it), you can pass an empty object cast to `PathMap`:

```ts
app.__setPathMapForTesting({} as PathMap) // values will be `undefined`
```

Prefer Pattern 1 in almost all cases.

### Compile-time enforcement

`PathKey` is a string-literal union derived from
`ReturnType<typeof buildPathRegistry>`, so invalid keys are rejected by
`tsgo` (`pnpm typecheck`). vitest's compile path uses esbuild and does NOT
enforce type-only directives like `@ts-expect-error` inside test cases —
rely on `pnpm typecheck` for type-level assertions.
