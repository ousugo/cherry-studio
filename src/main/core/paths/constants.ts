// EARLIEST path constants for the Electron main process.
//
// CONSTRAINTS:
//   - Zero dependencies (only node:os + node:path).
//   - MUST NOT import @shared / @main / electron / any business module.
//   - MUST NOT depend on Electron `app` (not ready at first import time).
//
// CONSUMERS:
//   - src/main/data/bootConfig/BootConfigService.ts
//   - src/main/core/paths/pathRegistry.ts

import os from 'node:os'
import path from 'node:path'

export const CHERRY_HOME_DIRNAME = '.cherrystudio'
export const CHERRY_HOME = path.join(os.homedir(), CHERRY_HOME_DIRNAME)
export const BOOT_CONFIG_PATH = path.join(CHERRY_HOME, 'boot-config.json')
