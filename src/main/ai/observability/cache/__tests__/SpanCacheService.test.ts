import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpanCacheService } from '../SpanCacheService'

function span(overrides: Partial<SpanEntity>): SpanEntity {
  return {
    id: 'span',
    name: 'span',
    parentId: '',
    traceId: 'trace',
    status: 'OK',
    kind: 'internal',
    attributes: undefined,
    isEnd: true,
    events: undefined,
    startTime: 1,
    endTime: 2,
    links: undefined,
    ...overrides
  }
}

describe('SpanCacheService', () => {
  let service: SpanCacheService
  let traceDir: string

  beforeEach(async () => {
    BaseService.resetInstances()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
    traceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'span-cache-service-'))
    vi.mocked(application.getPath).mockReset()
    vi.mocked(application.getPath).mockReturnValue(traceDir)
    mockMainLoggerService.error.mockClear()
    service = new SpanCacheService()
  })

  afterEach(async () => {
    await fs.rm(traceDir, { recursive: true, force: true })
  })

  it('activates without touching the trace path', async () => {
    await service._doInit()

    expect(service.isActivated).toBe(true)
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('keeps live spans in memory and reads them without touching the trace path', async () => {
    await service._doInit()
    service.setTopicId('trace-a', 'topic-a')
    service.saveEntity(span({ id: 'root', traceId: 'trace-a', modelName: undefined }))
    service.saveEntity(span({ id: 'model-a', traceId: 'trace-a', modelName: 'model-a' }))
    service.saveEntity(span({ id: 'model-b', traceId: 'trace-a', modelName: 'model-b' }))

    const spans = await service.getSpans('topic-a', 'trace-a', 'model-a')

    expect(spans.map((item) => item.id)).toEqual(['root', 'model-a'])
    expect(application.getPath).not.toHaveBeenCalled()
  })

  it('lazily reads historical trace data when memory has no matching trace', async () => {
    await service._doInit()
    const topicDir = path.join(traceDir, 'topic-a')
    await fs.mkdir(topicDir, { recursive: true })
    await fs.writeFile(
      path.join(topicDir, 'trace-a'),
      `${JSON.stringify(span({ id: 'history', topicId: 'topic-a', traceId: 'trace-a', modelName: 'model-a' }))}\n`
    )

    const spans = await service.getSpans('topic-a', 'trace-a', 'model-a')

    expect(spans.map((item) => item.id)).toEqual(['history'])
    expect(application.getPath).toHaveBeenCalledWith('feature.trace')
  })

  it('falls back to history when the trace id lingers in memory without matching spans', async () => {
    await service._doInit()
    const topicDir = path.join(traceDir, 'topic-a')
    await fs.mkdir(topicDir, { recursive: true })
    await fs.writeFile(
      path.join(topicDir, 'trace-a'),
      `${JSON.stringify(span({ id: 'history', topicId: 'topic-a', traceId: 'trace-a', modelName: 'model-a' }))}\n`
    )
    // Memory still knows the trace id (e.g. lingering meta) but holds no span matching the query.
    service.setTopicId('trace-a', 'topic-a')

    const spans = await service.getSpans('topic-a', 'trace-a', 'model-a')

    expect(spans.map((item) => item.id)).toEqual(['history'])
  })

  it('returns an empty list for missing history without logging an error', async () => {
    await service._doInit()

    await expect(service.getSpans('topic-a', 'missing-trace')).resolves.toEqual([])
    expect(mockMainLoggerService.error).not.toHaveBeenCalled()
  })

  it('rejects a path-traversal topicId instead of escaping the trace root (REGRESSION observability-1)', async () => {
    await service._doInit()
    // A sentinel sibling of the trace root that a `../` traversal would target for deletion.
    const sentinelDir = await fs.mkdtemp(path.join(os.tmpdir(), 'span-cache-sentinel-'))
    const sentinelFile = path.join(sentinelDir, 'keep.txt')
    await fs.writeFile(sentinelFile, 'do not delete')

    const traversal = `..${path.sep}${path.basename(sentinelDir)}`
    await expect(service.cleanTopic(traversal)).rejects.toThrow(/invalid topicId/)
    // The traversal target survives — no arbitrary delete happened.
    await expect(fs.access(sentinelFile)).resolves.toBeUndefined()

    await fs.rm(sentinelDir, { recursive: true, force: true })
  })

  it('does not infinitely recurse on a self-parent span when accumulating usage (REGRESSION observability-2)', async () => {
    await service._doInit()
    service.saveEntity(span({ id: 'x', parentId: 'x', traceId: 'trace-cycle' }))

    const usage = { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    expect(() => service.updateTokenUsage('x', usage)).not.toThrow()
  })

  it('does not infinitely recurse on a parent cycle when accumulating outputs (REGRESSION observability-2)', async () => {
    await service._doInit()
    // a → b → a forms a cycle in the parent chain.
    service.saveEntity(span({ id: 'a', parentId: 'b', traceId: 'trace-cycle', modelName: 'm' }))
    service.saveEntity(span({ id: 'b', parentId: 'a', traceId: 'trace-cycle', modelName: 'm' }))

    expect(() => service.addStreamMessage('a', 'm', 'chunk', { type: 'text' })).not.toThrow()
  })
})
