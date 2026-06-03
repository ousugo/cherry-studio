import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures/provider'

// The Gemini fetcher resolves the rotated API key off the ProviderService
// singleton, then performs the HTTP call through @ai-sdk/provider-utils'
// getFromApi. Mock both at the module boundary: ProviderService to avoid the DB,
// and provider-utils' getFromApi to capture the exact { url, headers } passed.
const { getRotatedApiKeyMock, aiSdkGetFromApiMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<(providerId: string) => Promise<string>>(),
  aiSdkGetFromApiMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock
  }
}))

vi.mock('@ai-sdk/provider-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-sdk/provider-utils')>()
  return {
    ...actual,
    getFromApi: aiSdkGetFromApiMock
  }
})

// Import the SUT after the mocks are declared.
const { listModels } = await import('../listModels')

beforeEach(() => {
  vi.clearAllMocks()
  getRotatedApiKeyMock.mockResolvedValue('AIza-secret-key')
  // listModels' getFromApi wrapper reads `value` off the provider-utils result.
  aiSdkGetFromApiMock.mockResolvedValue({
    value: {
      models: [{ name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'fast' }]
    }
  })
})

function makeGeminiProvider() {
  return makeProvider({
    id: 'gemini',
    defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
    endpointConfigs: {
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
      }
    }
  })
}

describe('listModels — geminiFetcher API key transport', () => {
  it('passes the API key via the x-goog-api-key header, never the ?key= query (REGRESSION)', async () => {
    const provider = makeGeminiProvider()

    await listModels(provider)

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string; headers: Record<string, string> }

    // The key must NOT leak into the URL (it would be logged via APICallError.url).
    expect(call.url).not.toContain('AIza-secret-key')
    expect(call.url).not.toContain('key=')
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')

    // The key travels in the header instead.
    expect(call.headers['x-goog-api-key']).toBe('AIza-secret-key')
  })

  it('forwards provider extraHeaders alongside x-goog-api-key', async () => {
    const provider = makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
        }
      },
      settings: { extraHeaders: { 'X-Custom': 'on' } } as never
    })

    await listModels(provider)

    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers['x-goog-api-key']).toBe('AIza-secret-key')
    expect(call.headers['X-Custom']).toBe('on')
  })

  it('maps the listed models, stripping the models/ prefix from the id', async () => {
    const provider = makeGeminiProvider()

    const models = await listModels(provider)

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('gemini-2.0-flash')
    expect(models[0].name).toBe('Gemini 2.0 Flash')
  })
})
