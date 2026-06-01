import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { describe, expect, it, vi } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures'

const mockGetRotatedApiKey = vi.fn()

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: (...args: unknown[]) => mockGetRotatedApiKey(...args)
  }
}))

const { providerToAiSdkConfig } = await import('../config')

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'dashscope',
    ...overrides
  } as Model
}

describe('providerToAiSdkConfig', () => {
  it('uses DashScope provider for openai-compatible endpoint', async () => {
    mockGetRotatedApiKey.mockResolvedValue('test-key')

    const config = await providerToAiSdkConfig(
      makeProvider({
        id: 'dashscope',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/',
            adapterFamily: 'openai-compatible'
          }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      }),
      makeModel()
    )

    expect(config.providerId).toBe('dashscope')
    expect(config.providerSettings).toMatchObject({
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'test-key'
    })
  })

  it('keeps DashScope anthropic endpoint on the anthropic provider', async () => {
    mockGetRotatedApiKey.mockResolvedValue('test-key')

    const config = await providerToAiSdkConfig(
      makeProvider({
        id: 'dashscope',
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
            adapterFamily: 'anthropic'
          }
        },
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      }),
      makeModel()
    )

    expect(config.providerId).toBe('anthropic')
  })
})
