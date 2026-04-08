import { describe, expect, it, vi } from 'vitest'

// Mock @main/core/paths/pathRegistry (the deep path used by Application.ts)
// instead of the public @main/core/paths re-export. The public entry only
// re-exports types — Application.ts imports the buildPathRegistry function
// from the deep path, so that's where the mock has to live.
//
// We provide a minimal map containing only the keys the tests touch; the
// real pathRegistry.ts would call Electron `app.getPath()` at function
// invocation time, which is not stubbed in tests/main.setup.ts.
vi.mock('@main/core/paths/pathRegistry', () => ({
  buildPathRegistry: () =>
    Object.freeze({
      'feature.files.data': '/mock/userData/Data/Files'
    })
}))

import { Application } from '@main/core/application/Application'
import { buildPathRegistry } from '@main/core/paths/pathRegistry'

// Bypass the global mock of '@main/core/application' (which exports a stub
// `application` proxy with a no-op bootstrap) by importing the real
// Application class directly via its file path. The global mock only
// intercepts the directory/index path.

describe('Application.getPath', () => {
  const app = Application.getInstance()
  // Inject the mocked path registry without running the heavyweight
  // bootstrap() flow (which would try to register signal handlers,
  // await app.whenReady(), and start lifecycle phases).
  app.__setPathMapForTesting(buildPathRegistry())

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

  describe('pre-bootstrap throw guard', () => {
    it('throws a clear error when pathMap is null (pre-bootstrap)', () => {
      // Temporarily reset pathMap to simulate the pre-bootstrap state.
      app.__setPathMapForTesting(null)
      expect(() => app.getPath('feature.files.data')).toThrowError(/called before Application\.bootstrap\(\) ran/)
      // Restore the mock so subsequent tests in any rerun keep working.
      app.__setPathMapForTesting(buildPathRegistry())
    })
  })

  // Note: compile-time PathKey enforcement is verified via `pnpm typecheck`
  // (which runs tsgo). vitest's compile path uses esbuild and does not
  // enforce type-only directives like @ts-expect-error reliably, so we do
  // not assert them here.
})
