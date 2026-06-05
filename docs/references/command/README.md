# Command System

The command system is the single source of truth for **what the app can do** and
the wiring that lets a keyboard shortcut, an application/context menu item, or a
button all trigger the same behavior.

It replaces three previously independent systems (keyboard shortcuts, the native
application menu, and ad‑hoc context menus), each of which used to maintain its
own definitions, key‑formatting, and dispatch wiring.

- [command-usage.md](./command-usage.md) — how to register handlers, contribute
  menus, render command‑backed UI, and add a new command.

## Commands, shortcuts, and menus — the relationship

**A command is *what* the app does; a shortcut is one *way* to ask for it.** They
are deliberately separate concepts:

- A **command** is the unit of behavior, identified by a `CommandId` (e.g.
  `topic.create`, `app.zoom.in`, `chat.message.search`). It owns the behavior and
  knows nothing about how it was triggered.
- A **shortcut** is a key binding *for* a command. A **menu item** is a menu entry
  *for* a command. A **button** invokes a command. All of them are just triggers
  that resolve to a `CommandId` and run its handler.

```
 keyboard shortcut ─┐
 menu item ─────────┼──▶  CommandId  ──▶  handler (renderer or main)
 button / palette ──┘
```

Two consequences fall out of this split:

- **There are no free‑floating shortcuts.** Every shortcut, menu item, and button
  resolves to a command. You never bind a key to an inline callback — you bind it
  to a `CommandId`, and a surface registers the handler separately. Adding a new
  way to trigger something never touches the behavior, and changing the behavior
  never touches its triggers.
- **A command can have zero, one, or several triggers.** A command may be
  menu‑only (no default key), keyboard‑only, or both; the keybinding even allows
  `additionalBindings` (e.g. numpad zoom). The command is the same either way.

### How a command relates to its shortcut

| Concept | Where it lives | Example for `topic.create` |
| --- | --- | --- |
| Command definition | `COMMAND_DEFINITIONS` (`src/shared/commands/definitions.ts`) | `{ id: 'topic.create', scope: 'renderer', keybinding: { defaultBinding: ['CommandOrControl','N'] } }` |
| Default key binding | the command's `keybinding.defaultBinding` | `Cmd/Ctrl + N` |
| **User override** | the preference `shortcut.<commandId>` | `shortcut.topic.create` → `{ binding, enabled }` |
| Handler | a surface via `useCommandHandler` (renderer) or a built‑in (main) | `useCommandHandler('topic.create', addNewTopic)` |
| Menu entry (optional) | a `MENU_CONTRIBUTIONS` entry | `{ location: 'chat.input.tools.context', command: 'topic.create' }` |

So there is exactly **one shortcut preference key per command** (`shortcut.<id>`):
the command's *default* binding comes from its definition, and the user's edit in
**Settings → Shortcuts** overrides it through that preference key. At runtime the
effective binding is "user preference if set, else the definition default".

A command's `scope: 'main' | 'renderer' | 'both'` decides where its handler runs
and who listens for its key: the main‑process global‑shortcut registrar
(`ShortcutService`) for main/global, or the per‑window keydown dispatcher
(`CommandProvider`) for renderer.

`COMMAND_DEFINITIONS` is the single source of truth — the `CommandId` union, the
keybinding rules, the per‑command `shortcut.<id>` key, and the `when`/`enablement`
context expressions are all derived from it. Menu contributions are a parallel
declaration (`MENU_CONTRIBUTIONS`) keyed by the same `CommandId`s.

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

Mount `<ContextKeyProvider><CommandProvider>` once per renderer window — every
window root mounts it: `windows/main/MainApp.tsx`,
`windows/settings/SettingsApp.tsx`, and `windows/subWindow/SubWindowApp.tsx`.

### Preferences

- `shortcut.<commandId>` — `PreferenceShortcutType` (`{ binding, enabled }`), the
  editable binding per command. Generated through the data‑classify pipeline (see
  [command-usage.md](./command-usage.md#adding-a-command)).
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
