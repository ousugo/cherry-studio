# WindowManager Reference

This is the main entry point for Cherry Studio's WindowManager documentation. WindowManager is a lifecycle-managed service that creates, tracks, and reuses Electron `BrowserWindow` instances with three lifecycle modes (default / singleton / pooled), IPC broadcast, domain-service event hooks, and elastic pool reuse.

## Quick Navigation

### System Overview (Architecture)

- [Overview](./window-manager-overview.md) — Core types, three lifecycle modes, event timing contract

### Usage Guide (Code Examples)

- [Usage Guide](./window-manager-usage.md) — Quick Start, domain-service integration pattern, consumer-vs-internal API layering, anti-patterns, `useWindowInitData` hook

### Reference Guides

- [Pool Mechanics](./window-manager-pool-mechanics.md) — Two-axis pool model, config matrix, GC timer, warmup, suspend/resume, `WindowManager_Reused` IPC
- [Platform Configuration](./window-manager-platform.md) — Static `platformOverrides` and runtime `quirks` (macOS focus / hover / always-on-top)
- [API Reference](./window-manager-api-reference.md) — Full method tables: open/close/create/destroy, window ops, queries, broadcast, init data, pool management, events
- [Migration Guide](./window-manager-migration-guide.md) — Converting direct `BrowserWindow` usage to WindowManager

---

## Choosing the Right Lifecycle

| Mode | Instances | `open()` behavior | `close()` behavior | Use for |
|---|---|---|---|---|
| `default` | many | fresh create every call | destroys permanently | Windows that appear in parallel (e.g. detached tabs) |
| `singleton` | at most one | creates, or shows + focuses the existing one | destroys the sole instance | Unique windows (main, settings) |
| `pooled` | many, reusable | pops an idle window, or creates fresh if empty | returns to the idle pool, or destroys if over cap | Frequently opened windows where creation cost matters (selection actions) |

Full mode semantics and registry examples: [Overview → Three Lifecycle Modes](./window-manager-overview.md#three-lifecycle-modes).

---

## Consumer vs Internal APIs

WindowManager's lifecycle methods are arranged in two layers. **Consumer code should only ever call `open()` and `close()`** — the registry's `lifecycle` declaration tells them how to behave for each window type.

| Layer | Methods | Role |
|---|---|---|
| **Consumer** | `open(type, args?)`, `close(windowId)` | Lifecycle-aware; the only APIs business code should need |
| Internal | `create(type, args?)`, `destroy(windowId)` | Defensive / escape-hatch primitives; prefer `open()` + `onWindowCreated` instead |

Behavioral injection goes through **`onWindowCreated`** — see [Usage → Injecting behavior](./window-manager-usage.md#injecting-behavior-onwindowcreated-is-the-canonical-hook).

---

## Common Anti-patterns

| Wrong Choice | Why It's Wrong | Correct Choice |
|---|---|---|
| Attaching listeners directly after `wm.open()` returns | Reused windows (singleton reopen, pool recycle) accumulate duplicate listeners; forces you off `open()` onto `create()` | Subscribe to **`onWindowCreated`**, filter by `managed.type` |
| Using `wm.create()` in business code | Singleton uniqueness is already guaranteed by registry `lifecycle`; `onWindowCreated` handles "run setup on fresh" | Use `wm.open()` + `onWindowCreated` |
| Using `wm.destroy()` in business code | On non-pooled windows, identical to `close()`. On pooled windows, bypasses pool — rarely desired | Use `wm.close()`; for pool-wide shutdown, use `suspendPool(type)` |
| Attaching `resized` / per-window `closed` listeners at the `open()` call site for a pooled window | Pool recycle does not re-fire `onWindowCreated`, so reused windows miss them or double up on re-open | Attach inside `onWindowCreated` — it fires exactly once per `BrowserWindow` instance |
| Setting `paintWhenInitiallyHidden: false` on a pooled window to "delay show until content is ready" | Suppresses native `ready-to-show`, breaking the fresh-window auto-show path | Use `show: false` + consumer-driven `show()`, or rely on the `Reused` payload to ensure data arrives before `.show()` |

---

## Related Source Code

### Core Infrastructure

- `src/main/core/window/WindowManager.ts` — Service implementation
- `src/main/core/window/windowRegistry.ts` — Per-type metadata (lifecycle, pool config, quirks, platform overrides)
- `src/main/core/window/types.ts` — `WindowType`, `WindowTypeMetadata`, `PoolConfig`, `ManagedWindow`
- `src/main/core/window/quirks.ts` — macOS method-slot monkey-patches

### Renderer Integration

- `src/renderer/src/core/hooks/useWindowInitData.ts` — Canonical hook for init data consumption
- `packages/shared/IpcChannel.ts` — `WindowManager_*` IPC channel constants
