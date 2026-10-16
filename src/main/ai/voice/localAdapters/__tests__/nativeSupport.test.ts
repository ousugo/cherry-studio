import { mkdir, rm } from 'node:fs/promises'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { VoiceCleanupError, VoiceRuntimeError } from '../../VoiceRuntimeError'
import { withScratch } from '../nativeSupport'

vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), rm: vi.fn() }))

beforeEach(() => {
  vi.mocked(application.getPath).mockReturnValue('/voice-scratch')
  vi.mocked(mkdir).mockResolvedValue(undefined)
  vi.mocked(rm).mockRejectedValue(new Error('/private/audio.wav cleanup canary'))
  mockMainLoggerService.warn.mockClear()
})

describe('voice scratch cleanup failures', () => {
  it.each(['aborted', 'timeout', 'unsupported'] as const)(
    'marks cleanup failure while preserving the original %s reason',
    async (reason) => {
      const error = await withScratch(async () => {
        throw new VoiceRuntimeError(reason)
      }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(VoiceCleanupError)
      expect(error).toMatchObject({ reason })
      expect(JSON.stringify(mockMainLoggerService.warn.mock.calls)).not.toContain('canary')
    }
  )

  it('returns a sanitized failure when successful work cannot be cleaned up', async () => {
    await expect(withScratch(async () => 'result')).rejects.toMatchObject({
      reason: 'operation_failed',
      message: 'operation_failed'
    })
  })
})
