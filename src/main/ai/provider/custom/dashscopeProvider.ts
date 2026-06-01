import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel
} from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { OpenAICompatibleRerankingModel } from '@cherrystudio/ai-core/provider'

export const DASHSCOPE_PROVIDER_NAME = 'dashscope' as const

const DASHSCOPE_RERANK_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-api/v1'

export interface DashScopeProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface DashScopeProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
  rerankingModel(modelId: string): RerankingModelV3
}

export function createDashScope(options: DashScopeProviderSettings = {}): DashScopeProvider {
  const { baseURL = '', fetch: customFetch } = options

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'DASHSCOPE_API_KEY', description: 'DashScope' })

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...options.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  // DashScope chat uses /compatible-mode/v1, but Bailian rerank's OpenAI-compatible API
  // is fixed at /compatible-api/v1/reranks. See https://help.aliyun.com/zh/model-studio/rerank
  const rerankUrl = ({ path }: { path: string; modelId: string }) =>
    `${DASHSCOPE_RERANK_BASE_URL}${path === '/rerank' ? '/reranks' : path}`

  const createChatModel = (modelId: string): LanguageModelV3 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.imageModel = (modelId: string) =>
    new OpenAICompatibleImageModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.image`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.rerankingModel = (modelId: string) =>
    new OpenAICompatibleRerankingModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.rerank`,
      url: rerankUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  return provider as DashScopeProvider
}
