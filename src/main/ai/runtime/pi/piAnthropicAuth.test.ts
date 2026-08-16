import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { withAnthropicApiKeyHeaderStream } from './piAnthropicAuth'

describe('withAnthropicApiKeyHeaderStream', () => {
  it('moves the runtime key to the provider-specific header and suppresses Anthropic defaults', () => {
    const apiStreamSimple = vi.fn<NonNullable<ProviderConfig['streamSimple']>>(() => ({}) as never)
    const config = withAnthropicApiKeyHeaderStream({} as ProviderConfig, 'api-key', apiStreamSimple)

    config.streamSimple?.({} as never, {} as never, {
      apiKey: 'sk-dots-key',
      headers: { 'x-extra': 'kept' }
    })

    expect(apiStreamSimple).toHaveBeenCalledOnce()
    expect(apiStreamSimple.mock.calls[0][2]).toMatchObject({
      apiKey: 'sk-dots-key',
      headers: {
        'api-key': 'sk-dots-key',
        authorization: null,
        'x-api-key': null,
        'x-extra': 'kept'
      }
    })
  })
})
