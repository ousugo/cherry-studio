/**
 * Path registry — the single source of truth for all main-process paths.
 *
 * **Read `./README.md` first** for naming conventions, namespace taxonomy,
 * the meaning of the `.` separator, and how to add a new key.
 *
 * Quick reference:
 *   - Format: `namespace.sub.key_name` matching /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
 *   - Five top-level namespaces: cherry / sys / app / feature / external
 *   - File suffix: `_file` for standalone files (e.g. `app.exe_file`); `.file`
 *     last segment for files inside a namespace with siblings (e.g.
 *     `app.database.file` paired with `app.database.migrations`)
 *
 * **IMPORTANT — file-level constraint**: Do NOT define any object literals
 * other than the registry returned from `buildPathRegistry()` in this file.
 * The ESLint rule `data-schema-key/valid-key` validates EVERY property name
 * with a string-literal key in the file — including those inside function
 * bodies. Helper objects like `{ darwin: '...', win32: '...' }` would trip
 * the rule on `darwin` / `win32`. Helper constants must be `string` or
 * `number` only. If you need a helper object, put it in a separate file.
 */

import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { CHERRY_HOME, LOGS_DIR } from './constants'

/**
 * Build the frozen path registry. Called exactly once from
 * `Application.bootstrap()`. Must be invoked AFTER all `app.setPath()`
 * calls have completed and BEFORE any lifecycle service starts.
 *
 * Reading paths through `application.getPath(key, filename?)` is the
 * sole supported access pattern; do not import this function from
 * `@main/core/paths`. The deep alias `@main/core/paths/pathRegistry`
 * is reserved for `Application.ts` (and tests that mock the registry).
 */
export function buildPathRegistry() {
  // ============================================================
  // Intermediate vars — hoisted to avoid repeated path.join and to
  // let sub-keys reference their parents directly. Var names use
  // camelCase correspondence to their PATHS key.
  //
  // NOTE: these are `const` bindings of primitives (strings); NOT object
  // literals. Object literals are forbidden in this file (see top comment).
  // ============================================================
  const appUserData = app.getPath('userData')
  const appUserDataData = path.join(appUserData, 'Data')
  const appSession = app.getPath('sessionData')
  const sysTemp = app.getPath('temp')
  const appTemp = path.join(sysTemp, 'CherryStudio')
  const appResources = process.resourcesPath ?? path.join(app.getAppPath(), 'resources')

  // app.database.migrations: in dev, __dirname points to the bundled main's
  // directory (e.g. <project>/out/main/); walking up two levels reaches
  // project root. In packaged mode, migrations live under resources.
  // This mirrors the existing DbService.ts resolution.
  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'migrations/sqlite-drizzle')
    : path.join(__dirname, '../../migrations/sqlite-drizzle')

  return Object.freeze({
    // ============================================================
    // A. cherry.* — generic infrastructure under ~/.cherrystudio
    // ============================================================
    'cherry.home': CHERRY_HOME,
    'cherry.bin': path.join(CHERRY_HOME, 'bin'),
    'cherry.config': path.join(CHERRY_HOME, 'config'),

    // ============================================================
    // B. sys.* — operating-system directories
    // ============================================================
    'sys.home': os.homedir(),
    'sys.temp': sysTemp,
    'sys.downloads': app.getPath('downloads'),
    'sys.documents': app.getPath('documents'),
    'sys.desktop': app.getPath('desktop'),
    'sys.music': app.getPath('music'),
    'sys.pictures': app.getPath('pictures'),
    'sys.videos': app.getPath('videos'),
    'sys.appdata': app.getPath('appData'),
    'sys.appdata.autostart': path.join(app.getPath('appData'), 'autostart'), // Linux only

    // ============================================================
    // C. app.* — the Electron application itself
    // ============================================================
    'app.root': app.getAppPath(),
    'app.exe_file': app.getPath('exe'),
    'app.install': path.dirname(app.getPath('exe')),
    'app.logs': LOGS_DIR,
    'app.crash_dumps': app.getPath('crashDumps'),
    'app.session': appSession,
    'app.resources': appResources,
    'app.resources.scripts': path.join(appResources, 'scripts'),
    'app.resources.binaries': path.join(appResources, 'binaries'),
    'app.temp': appTemp,
    'app.userdata': appUserData,
    'app.userdata.data': appUserDataData,
    'app.database.file': path.join(appUserData, 'cherrystudio.sqlite'),
    'app.database.migrations': migrationsDir,

    // ============================================================
    // D. feature.* — Cherry-owned feature data / config / temp dirs
    //                (physical location is irrelevant; grouped by feature)
    // ============================================================
    // -- MCP feature --
    'feature.mcp': path.join(CHERRY_HOME, 'mcp'),
    'feature.mcp.oauth': path.join(CHERRY_HOME, 'config', 'mcp', 'oauth'),
    'feature.mcp.workspace': path.join(appUserDataData, 'Workspace'),

    // -- Trace feature --
    'feature.trace': path.join(CHERRY_HOME, 'trace'),

    // -- OVMS feature (OpenVINO Model Server) --
    'feature.ovms': path.join(CHERRY_HOME, 'ovms'),
    'feature.ovms.ovms': path.join(CHERRY_HOME, 'ovms', 'ovms'),
    'feature.ovms.patch': path.join(CHERRY_HOME, 'ovms', 'patch'),
    'feature.ovms.ovocr': path.join(CHERRY_HOME, 'ovms', 'ovocr'),

    // -- Agents feature --
    'feature.agents.skills': path.join(CHERRY_HOME, 'skills'),
    'feature.agents.skills.temp': path.join(appTemp, 'skill-install'),
    'feature.agents.claude.skills': path.join(appUserData, '.claude', 'skills'),
    'feature.agents.channels': path.join(appUserDataData, 'Channels'),

    // -- Files / Notes / Knowledgebase / Memory --
    'feature.files.data': path.join(appUserDataData, 'Files'),
    'feature.notes.data': path.join(appUserDataData, 'Notes'),
    'feature.knowledgebase.data': path.join(appUserDataData, 'KnowledgeBase'),
    'feature.memory.data': path.join(appUserDataData, 'Memory'),

    // -- Feature-owned temp dirs (physical root: app.temp) --
    'feature.backup.temp': path.join(appTemp, 'backup'),
    'feature.cli.temp': path.join(appTemp, 'cli'),
    'feature.dxt.uploads.temp': path.join(appTemp, 'dxt_uploads'),
    'feature.preprocess.temp': path.join(appTemp, 'preprocess'),
    'feature.lan_transfer.temp': path.join(appTemp, 'lan-transfer'),

    // ============================================================
    // E. external.* — third-party tool paths (Cherry is reader/writer,
    //                 NOT the owner; do not delete on uninstall)
    // ============================================================
    'external.openclaw.config': path.join(os.homedir(), '.openclaw')
  } as const)
}

/** Compile-time type derived from the builder's return type. */
export type PathMap = ReturnType<typeof buildPathRegistry>

/** String-literal union of all registered path keys. */
export type PathKey = keyof PathMap
