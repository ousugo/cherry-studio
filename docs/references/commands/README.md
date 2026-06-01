# Command System

The command system is the single source of truth for **what the app can do** and
the wiring that lets a keyboard shortcut, an application/context menu item, or a
button all trigger the same behavior.

It replaces three previously independent systems (keyboard shortcuts, the native
application menu, and ad‑hoc context menus), each of which used to maintain its
own definitions, key‑formatting, and dispatch wiring.

- [commands-usage.md](./commands-usage.md) — how to register handlers, contribute
  menus, render command‑backed UI, and add a new command.

## Commands, shortcuts, and menus — the relationship

A **command** is the unit of behavior, identified by a `CommandId` (e.g.
`topic.create`, `app.zoom.in`, `chat.message.search`). Commands are the center of
the model; shortcuts and menus are just two ways to invoke them.

```
 keyboard shortcut ─┐
 menu item ─────────┼──▶  CommandId  ──▶  handler (renderer or main)
 button / palette ──┘
```

- A **shortcut** is a keybinding attached to a command. Its user preference lives
  under `shortcut.<commandId>` (e.g. `shortcut.topic.create`). There is exactly
  one shortcut preference key per command.
- A **menu item** is a menu *contribution* that points at a command for a given
  menu location (e.g. `chat.input.tools.context`, `app.menu`).
- A command may be `scope: 'main' | 'renderer' | 'both'`, which decides where its
  handler runs and whether the global‑shortcut registrar (main) or the window
  keydown dispatcher (renderer) is responsible for it.

`COMMAND_DEFINITIONS` (in `src/shared/commands/definitions.ts`) is the single
source of truth. Everything else — the keybinding rules, the per‑command shortcut
preference key, and the `when`/`enablement` context expressions — is derived from
it. Menu contributions are a parallel declaration (`MENU_CONTRIBUTIONS`).

## Architecture — three layers

### 1. Shared declarations — `src/shared/commands/`

Pure data and pure functions, no Electron or React.

| File | Responsibility |
| --- | --- |
| `definitions.ts` | `COMMAND_DEFINITIONS` (SoT), the derived `CommandId`, `KEYBINDING_RULES`, `REGISTERED_KEYBINDINGS`, lookups |
| `keybindings.ts` | resolve a binding → command, default/effective shortcut preference, conflict detection, label formatting |
| `menus.ts` | `MENU_CONTRIBUTIONS`, the `MenuRegistry`, and `resolveMenuPresentationMode` |
| `contextExpr.ts` | parser/evaluator for `when`/`enablement` expressions + `ContextKeyService` |
| `types.ts` | all command/keybinding/menu/context types |

Token formatting (typed shortcut vocabulary, normalization, display/accelerator
formatting) lives in `src/shared/shortcuts/tokens.ts`; `src/shared/shortcuts/types.ts`
keeps only `ShortcutPreferenceKey` + `ResolvedShortcut`.

### 2. Main runtime — `src/main/services/`

| Service | Responsibility |
| --- | --- |
| `CommandService` | holds the main‑side handler registry; `execute(command, window?, ctx?)` with context evaluation; wires built‑in handlers (window/zoom/settings/quick‑assistant/selection) |
| `NativeCommandPopupMenuService` | materializes a renderer‑supplied menu model into an Electron native popup and reports the chosen command back |
| `ShortcutService` | registers `globalShortcut` accelerators from `REGISTERED_KEYBINDINGS` (non‑renderer scope) → `CommandService.execute` |
| `AppMenuService` | builds the macOS app menu from `menuRegistry.resolve({ location: 'app.menu' })` via `menu/adapters/nativeMenuAdapter` → `CommandService.execute` |

### 3. Renderer runtime — `src/renderer/commands/`

| Piece | Responsibility |
| --- | --- |
| `CommandProvider` | one window‑level `keydown` dispatcher + the handler stack (`useCommandHandler`, `useCommandRuntime`) |
| `ContextKeyProvider` | window‑local context keys (`useCommandContextKey`) |
| `presentation.tsx` | `CommandShortcut`, `CommandTooltip`, `CommandButton`, `useResolvedCommand` |
| `menus.tsx` | `CommandContextMenu` — renders Cherry UI or a native popup based on `menu.presentation_mode` |

Mount `<ContextKeyProvider><CommandProvider>` once per renderer window (the main
window mounts it in `windows/main/MainApp.tsx`).

### Preferences

- `shortcut.<commandId>` — `PreferenceShortcutType` (`{ binding, enabled }`), the
  editable binding per command. Generated through the data‑classify pipeline (see
  [commands-usage.md](./commands-usage.md#adding-a-command)).
- `menu.presentation_mode` — `'cherry' | 'native'`, exposed in
  **Settings → Common → Menu** ("Context menu style").

## Dispatch flows

- **Keyboard (renderer):** `keydown` → `CommandProvider` →
  `getShortcutBindingFromKeyboardEvent` →
  `resolveCommandByKeybinding({ scope: 'renderer', canExecuteCommand: hasHandler })`
  → active handler. The dispatcher skips `contenteditable` targets and only
  `preventDefault`s when a command with a registered handler resolves.
- **Keyboard (global):** OS `globalShortcut` → `ShortcutService` →
  `CommandService.execute(command, window)`.
- **Native menu:** renderer builds a `NativePopupMenuModel` →
  `window.api.command.showNativePopupMenu` → `NativeCommandPopupMenuService`.
  Main‑handled commands run there; renderer‑handled ones are returned to the
  renderer runtime to execute.
