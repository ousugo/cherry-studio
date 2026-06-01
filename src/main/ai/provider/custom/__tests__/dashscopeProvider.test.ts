import { describe, expect, it, vi } from 'vitest'

import { createDashScope } from '../dashscopeProvider'

describe('createDashScope', () => {
  it('uses Bailian compatible-api reranks endpoint for reranking', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        results: [{ index: 1, relevance_score: 0.9 }]
      })
    )

    const provider = createDashScope({
      apiKey: 'test-key',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
      fetch: fetchMock
    })

    const model = provider.rerankingModel('gte-rerank-v2')
    const result = await model.doRerank({
      query: 'query',
      documents: {
        type: 'text',
        values: ['alpha', 'beta']
      },
      topN: 1
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-api/v1/reranks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'gte-rerank-v2',
          query: 'query',
          documents: ['alpha', 'beta'],
          top_n: 1
        })
      })
    )
    expect(result.ranking).toEqual([{ index: 1, relevanceScore: 0.9 }])
  })
})
