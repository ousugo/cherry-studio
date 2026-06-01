import { BaseService } from '@main/core/lifecycle/BaseService'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockRerank = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()
const mockApplicationGet = vi.fn()
const mockProviderGetByProviderId = vi.fn()
const mockProviderGetRotatedApiKey = vi.fn()
const mockModelGetByKey = vi.fn()

vi.mock('@main/core/application', () => ({
  application: {
    get: mockApplicationGet
  }
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: unknown[]) => mockProviderGetByProviderId(...args),
    getRotatedApiKey: (...args: unknown[]) => mockProviderGetRotatedApiKey(...args)
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: (...args: unknown[]) => mockModelGetByKey(...args)
  }
}))

vi.mock('@main/utils/downloadAsBase64', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: vi.fn(),
  embedMany: vi.fn(),
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
  rerank: (...args: unknown[]) => mockRerank(...args)
}))

const { AiService } = await import('../AiService')

/**
 * Instantiate `AiService` directly (without going through the lifecycle
 * container) so unit tests can drive its methods in isolation.
 */
function createService(): InstanceType<typeof AiService> {
  BaseService.resetInstances()
  return new (AiService as any)()
}

describe('AiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderGetRotatedApiKey.mockResolvedValue('test-key')
    mockProviderGetByProviderId.mockResolvedValue({
      id: 'test-provider',
      name: 'Test Provider',
      apiKeys: [],
      authType: 'api-key',
      apiFeatures: {
        arrayContent: true,
        streamOptions: true,
        developerRole: false,
        serviceTier: false,
        verbosity: false
      },
      settings: {},
      isEnabled: true
    })
    mockModelGetByKey.mockResolvedValue({
      id: 'test-provider::test-model',
      providerId: 'test-provider',
      apiModelId: 'test-model',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
  })

  it('routes agent-session runtime requests directly to the runtime service', async () => {
    const service = createService()
    const stream = new ReadableStream()
    const openTurnStream = vi.fn(() => stream)
    mockApplicationGet.mockReturnValue({ openTurnStream })

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: 'turn-1' },
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).resolves.toBe(stream)

    expect(mockApplicationGet).toHaveBeenCalledWith('AgentSessionRuntimeService')
    expect(openTurnStream).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-1',
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects agent-session streams that do not carry a runtime request', async () => {
    const service = createService()
    const buildAgentParamsFor = vi.spyOn(service as any, 'buildAgentParamsFor')

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).rejects.toThrow('requires an agent-session runtime request')

    expect(buildAgentParamsFor).not.toHaveBeenCalled()
    expect(mockApplicationGet).not.toHaveBeenCalled()
  })

  it('normalizes base64 and url images from ai-core generateImage', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      }
    } as never)

    mockGenerateImage.mockResolvedValue({
      images: [{ base64: 'abc123', mediaType: 'image/png' }, { nonsense: true }],
      providerMetadata: {
        testProvider: {
          images: [{ url: 'https://example.com/image.png' }]
        }
      }
    })

    mockDownloadImageAsBase64.mockResolvedValue({
      data: 'url-base64',
      media_type: 'image/jpeg'
    })

    const result = await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      prompt: 'draw a cat',
      n: 2,
      size: '1024x1024',
      negativePrompt: 'blurry',
      seed: 7,
      quality: 'high',
      numInferenceSteps: 30,
      guidanceScale: 4.5,
      promptEnhancement: true,
      requestOptions: { signal: new AbortController().signal }
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-model',
        prompt: 'draw a cat',
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
      })
    )

    const callOptions = mockGenerateImage.mock.calls[0]?.[2]
    expect(callOptions.experimental_download).toBeTypeOf('function')

    const downloaded = await callOptions.experimental_download([
      {
        url: new URL('https://example.com/image.png'),
        isUrlSupportedByModel: false
      }
    ])

    expect(mockDownloadImageAsBase64).toHaveBeenCalledWith('https://example.com/image.png')
    expect(downloaded).toEqual([
      {
        data: Buffer.from('url-base64', 'base64'),
        mediaType: 'image/jpeg'
      }
    ])

    expect(result).toEqual({
      images: [{ kind: 'base64', data: 'data:image/png;base64,abc123', mediaType: 'image/png' }]
    })
  })

  it('routes rerank requests through ai-core rerank', async () => {
    const service = createService()
    const abortController = new AbortController()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-reranker'
      },
      options: {
        headers: { 'x-test': 'yes' },
        maxRetries: 0
      }
    } as never)

    mockRerank.mockResolvedValue({
      ranking: [
        { originalIndex: 1, score: 0.9, document: 'beta' },
        { originalIndex: 0, score: 0.2, document: 'alpha' }
      ]
    })

    await expect(
      service.rerank({
        uniqueModelId: 'test-provider::test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        requestOptions: {
          headers: { 'x-test': 'yes' },
          maxRetries: 0,
          signal: abortController.signal
        }
      })
    ).resolves.toEqual({
      ranking: [
        { originalIndex: 1, score: 0.9, document: 'beta' },
        { originalIndex: 0, score: 0.2, document: 'alpha' }
      ]
    })

    expect(mockRerank).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        headers: { 'x-test': 'yes' },
        maxRetries: 0,
        abortSignal: abortController.signal
      })
    )
  })

  it('checks rerank models with rerank before embedding or text generation', async () => {
    const service = createService()
    const rerankSpy = vi.spyOn(service, 'rerank').mockResolvedValue({ ranking: [] })
    const embedSpy = vi.spyOn(service, 'embedMany')
    const generateSpy = vi.spyOn(service, 'generateText')

    mockModelGetByKey.mockResolvedValue({
      id: 'test-provider::test-reranker',
      providerId: 'test-provider',
      apiModelId: 'test-reranker',
      name: 'Test Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK, MODEL_CAPABILITY.EMBEDDING],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'test-provider::test-reranker'
    })

    expect(rerankSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test',
        documents: ['test'],
        topN: 1
      })
    )
    expect(embedSpy).not.toHaveBeenCalled()
    expect(generateSpy).not.toHaveBeenCalled()
  })
})
