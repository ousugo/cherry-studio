import { describe, expect, it, vi } from 'vitest'

// Mock @main/core/paths to avoid loading the real pathRegistry.ts at test time.
// pathRegistry.ts top-level calls Electron `app.getAppPath()` and reads
// `app.isPackaged`, neither of which is stubbed in tests/main.setup.ts. Instead
// we provide a minimal PATHS map containing only the keys the tests touch.
vi.mock('@main/core/paths', () => ({
  PATHS: Object.freeze({
    'feature.files.data': '/mock/userData/Data/Files'
  })
}))

import { Application } from '@main/core/application/Application'

// Bypass the global mock of '@main/core/application' (which exports a stub
// `application` proxy) by importing the real Application class directly via
// its file path. The global mock only intercepts the directory/index path.

describe('Application.getPath', () => {
  const app = Application.getInstance()

  describe('basic lookup', () => {
    it('returns the registered path when no filename is given', () => {
      expect(app.getPath('feature.files.data')).toBe('/mock/userData/Data/Files')
    })

    it('joins a single-segment filename to the registered path', () => {
      // node:path.join is mocked in main.setup.ts to use '/' separator
      expect(app.getPath('feature.files.data', 'valid.txt')).toBe('/mock/userData/Data/Files/valid.txt')
    })
  })

  describe('filename validation — graceful degradation', () => {
    // The validation logs a warning via loggerService but does NOT throw.
    // This lets gradual migration continue when callers temporarily use
    // multi-segment filenames; the warning is a developer-facing hint.

    it('does not throw when filename is absolute', () => {
      expect(() => app.getPath('feature.files.data', '/abs/path')).not.toThrow()
    })

    it('does not throw when filename contains ".."', () => {
      expect(() => app.getPath('feature.files.data', '../escape')).not.toThrow()
    })

    it('does not throw when filename contains a path separator', () => {
      expect(() => app.getPath('feature.files.data', 'sub/file.txt')).not.toThrow()
    })

    it('returns a non-empty string even for suspicious filenames', () => {
      const result = app.getPath('feature.files.data', '../escape')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  // Note: compile-time PathKey enforcement (D7) is verified via `pnpm typecheck`
  // (which runs tsgo). vitest's compile path uses esbuild and does not enforce
  // type-only directives like @ts-expect-error reliably, so we do not assert
  // them here.
})
