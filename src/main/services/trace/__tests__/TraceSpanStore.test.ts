import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import { describe, expect, it } from 'vitest'

import { TraceSpanStore } from '../TraceSpanStore'

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

describe('TraceSpanStore', () => {
  it('keeps spans isolated by trace id and topic id', () => {
    const store = new TraceSpanStore()
    store.setSpan(span({ id: 'a', traceId: 'trace-a', topicId: 'topic-a', modelName: 'model-a' }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b', topicId: 'topic-b', modelName: 'model-b' }))

    expect(store.getSpans({ topicId: 'topic-a', traceId: 'trace-a' }).map((item) => item.id)).toEqual(['a'])
    expect(store.getSpans({ topicId: 'topic-b', traceId: 'trace-b' }).map((item) => item.id)).toEqual(['b'])
  })

  it('filters model spans while preserving shared unmodelled parents for display', () => {
    const store = new TraceSpanStore()
    store.setSpan(span({ id: 'root', traceId: 'trace', topicId: 'topic', modelName: undefined }))
    store.setSpan(span({ id: 'model-a', traceId: 'trace', topicId: 'topic', modelName: 'model-a' }))
    store.setSpan(span({ id: 'model-b', traceId: 'trace', topicId: 'topic', modelName: 'model-b' }))

    expect(store.getSpans({ topicId: 'topic', traceId: 'trace', modelName: 'model-a' }).map((item) => item.id)).toEqual(
      ['root', 'model-a']
    )
  })

  it('clears only the requested topic trace', () => {
    const store = new TraceSpanStore()
    store.setSpan(span({ id: 'a', traceId: 'trace-a', topicId: 'topic-a', modelName: 'model-a' }))
    store.setSpan(span({ id: 'b', traceId: 'trace-b', topicId: 'topic-b', modelName: 'model-b' }))

    store.clearTopic('topic-a')

    expect(store.getSpans({ topicId: 'topic-a', traceId: 'trace-a' })).toEqual([])
    expect(store.getSpans({ topicId: 'topic-b', traceId: 'trace-b' }).map((item) => item.id)).toEqual(['b'])
  })
})
