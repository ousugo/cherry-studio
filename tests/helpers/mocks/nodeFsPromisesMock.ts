import { vi } from 'vitest'

/**
 * Factory for `vi.mock('node:fs/promises', ...)`. Same shape as
 * `nodeFsMock.ts` but for the promises namespace — tests that need to
 * neutralize filesystem writes (mkdir, writeFile, unlink, etc.) without
 * losing the real surface area for unrelated calls (readFile, etc.).
 *
 * The global `tests/main.setup.ts` keeps `node:fs/promises` fully real so
 * third-party libraries can read files normally. Tests that need
 * deterministic write/delete behaviour declare a local override:
 *
 *   import { createNodeFsPromisesMock } from '@test-helpers/mocks/nodeFsPromisesMock'
 *
 *   vi.mock('node:fs/promises', async () => createNodeFsPromisesMock())
 */
export async function createNodeFsPromisesMock() {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const mocked = {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined)
  }
  return { ...mocked, default: mocked }
}
