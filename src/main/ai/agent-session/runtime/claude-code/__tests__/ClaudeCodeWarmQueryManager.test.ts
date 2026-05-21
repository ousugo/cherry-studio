import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startupMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  startup: startupMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

const { ClaudeCodeWarmQueryManager, createClaudeCodeWarmQuerySignature } = await import('../ClaudeCodeWarmQueryManager')

function warmQuery() {
  return {
    query: vi.fn(),
    close: vi.fn()
  }
}

describe('ClaudeCodeWarmQueryManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes a matching warm query once', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    const abortController = new AbortController()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1', abortController } as any })

    const consumed = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    const second = await manager.consume({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })

    expect(consumed).toBe(warm)
    expect(second).toBeUndefined()
    expect(startupMock).toHaveBeenCalledWith({
      options: { model: 'sonnet', resume: 'sdk-1' },
      initializeTimeoutMs: undefined
    })
    expect(warm.close).not.toHaveBeenCalled()
  })

  it('closes a stale warm query when session options change', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const stale = warmQuery()
    const current = warmQuery()
    startupMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(current)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet', resume: 'sdk-1' } as any })
    manager.prewarm({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    await Promise.resolve()
    const consumed = await manager.consume({ key: 'session-1', options: { model: 'opus', resume: 'sdk-1' } as any })

    expect(stale.close).toHaveBeenCalledOnce()
    expect(consumed).toBe(current)
  })

  it('uses the same signature with or without abortController', () => {
    const withAbort = createClaudeCodeWarmQuerySignature({
      model: 'sonnet',
      resume: 'sdk-1',
      abortController: new AbortController()
    } as any)
    const withoutAbort = createClaudeCodeWarmQuerySignature({ model: 'sonnet', resume: 'sdk-1' } as any)

    expect(withAbort).toBe(withoutAbort)
  })

  it('closes unused warm queries after the idle ttl', async () => {
    const manager = new ClaudeCodeWarmQueryManager()
    const warm = warmQuery()
    startupMock.mockResolvedValueOnce(warm)

    manager.prewarm({ key: 'session-1', options: { model: 'sonnet' } as any })
    await Promise.resolve()
    vi.advanceTimersByTime(5 * 60 * 1000)
    await Promise.resolve()

    expect(warm.close).toHaveBeenCalledOnce()
  })
})
