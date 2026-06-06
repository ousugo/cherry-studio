import { createHmac } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignatureClient } from '../index'

describe('SignatureClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates CherryAI signature headers from request fields', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-11-14T22:13:20.000Z'))

    const client = new SignatureClient('client-id', 'secret')
    const body = { model: 'qwen', messages: [{ role: 'user', content: 'hello' }] }
    const expected = createHmac('sha256', 'secret')
      .update(['POST', '/chat/completions', '', 'client-id', '1700000000', JSON.stringify(body)].join('\n'))
      .digest('hex')

    expect(
      client.generateSignature({
        method: 'POST',
        path: '/chat/completions',
        query: '',
        body
      })
    ).toEqual({
      'X-Client-ID': 'client-id',
      'X-Timestamp': '1700000000',
      'X-Signature': expected
    })
  })
})
