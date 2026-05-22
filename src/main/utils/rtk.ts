import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { gte as semverGte } from 'semver'

import { isWin } from '../constant'
import { toAsarUnpackedPath } from '.'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('Utils:Rtk')

const RTK_BINARY = isWin ? 'rtk.exe' : 'rtk'
const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000

// rtk is not available for these platforms
const UNSUPPORTED_PLATFORMS = new Set(['win32-arm64'])

let rtkPath: string | null = null
let rtkAvailable: boolean | null = null

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function isPlatformSupported(): boolean {
  return !UNSUPPORTED_PLATFORMS.has(getPlatformKey())
}

/**
 * Resolve the bundled rtk binary path. It ships inside `app.asar.unpacked/`
 * already +x and executable in place — no user-side copy required.
 */
function resolveBundledRtkPath(): string | null {
  if (!isPlatformSupported()) return null
  const dir = toAsarUnpackedPath(path.join(application.getPath('app.root.resources.binaries'), getPlatformKey()))
  const candidate = path.join(dir, RTK_BINARY)
  return fs.existsSync(candidate) ? candidate : null
}

async function checkRtkAvailable(): Promise<boolean> {
  if (rtkAvailable !== null) return rtkAvailable

  rtkPath = resolveBundledRtkPath()
  if (!rtkPath) {
    rtkAvailable = false
    logger.debug('rtk binary not found')
    return false
  }

  try {
    const { stdout } = await execFileAsync(rtkPath, ['--version'], {
      timeout: REWRITE_TIMEOUT_MS
    })
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) {
      const version = match[1]
      if (!semverGte(version, RTK_MIN_VERSION)) {
        logger.warn(`rtk version too old (need >= ${RTK_MIN_VERSION})`, { version })
        rtkAvailable = false
        return false
      }
      logger.info('rtk available', { version, path: rtkPath })
    }
    rtkAvailable = true
  } catch (error) {
    logger.warn('Failed to check rtk version', {
      error: error instanceof Error ? error.message : String(error)
    })
    rtkAvailable = false
  }

  return rtkAvailable
}

/**
 * Rewrite a shell command using rtk for token-optimized output.
 * Returns the rewritten command, or null if no rewrite is available.
 */
export async function rtkRewrite(command: string): Promise<string | null> {
  if (!(await checkRtkAvailable()) || !rtkPath) {
    return null
  }

  try {
    const { stdout } = await execFileAsync(rtkPath, ['rewrite', command], {
      timeout: REWRITE_TIMEOUT_MS
    })
    const rewritten = stdout.trim()

    if (!rewritten || rewritten === command) {
      return null
    }

    return rewritten
  } catch {
    // rtk rewrite exits 1 when there's no rewrite — expected behavior
    return null
  }
}
