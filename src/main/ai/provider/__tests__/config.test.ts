import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { AuthConfig } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'

// providerToAiSdkConfig reads the rotated API key and (for Vertex/Bedrock) the
// auth config off the direct-import ProviderService singleton. Mock both at the
// module boundary so the dispatch builders run without touching the DB.
const { getRotatedApiKeyMock, getAuthConfigMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<(providerId: string) => Promise<string>>(),
  getAuthConfigMock: vi.fn<(providerId: string) => Promise<AuthConfig | null>>()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    getAuthConfig: getAuthConfigMock
  }
}))

// Import the SUT after the mock is declared.
const { providerToAiSdkConfig } = await import('../config')

beforeEach(() => {
  vi.clearAllMocks()
  getRotatedApiKeyMock.mockResolvedValue('sk-test-key')
  getAuthConfigMock.mockResolvedValue(null)
})

describe('providerToAiSdkConfig — builder dispatch matrix', () => {
  describe('Vertex routing (google-vertex AND google-vertex-anthropic → buildVertexConfig)', () => {
    const vertexAuth: AuthConfig = {
      type: 'iam-gcp',
      project: 'my-project',
      location: 'us-central1',
      // buildVertexConfig reads `privateKey` (camelCase) and runs it through
      // formatPrivateKey, which throws on an empty string.
      credentials: {
        client_email: 'svc@my-project.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n'
      }
    }

    it('routes a google-vertex-anthropic endpoint to buildVertexConfig, retaining project/location/googleCredentials (REGRESSION)', async () => {
      // The active endpoint carries adapterFamily 'google-vertex-anthropic', which
      // resolveAiSdkProviderId self-maps to the same aiSdkProviderId. Without the
      // 'google-vertex-anthropic' row in the dispatch table this falls through to
      // the generic builder and silently DROPS project/location/googleCredentials.
      getAuthConfigMock.mockResolvedValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex-anthropic'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::claude-3-7-sonnet',
        apiModelId: 'claude-3-7-sonnet',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      // Routed to the anthropic Vertex builder, not the generic fallback.
      expect(config.providerId).toBe('google-vertex-anthropic')
      // The fixed bug: these three fields survive instead of being dropped.
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
      expect(settings.googleCredentials).toMatchObject({
        client_email: 'svc@my-project.iam.gserviceaccount.com'
      })
      // Anthropic publisher baseURL suffix is appended by buildVertexConfig.
      expect(settings.baseURL).toBe('https://us-central1-aiplatform.googleapis.com/v1/publishers/anthropic/models')
    })

    it('routes a normal google-vertex endpoint to buildVertexConfig with the google publisher baseURL', async () => {
      getAuthConfigMock.mockResolvedValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::gemini-2.0-flash',
        apiModelId: 'gemini-2.0-flash',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('google-vertex')
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
      expect(settings.baseURL).toBe('https://us-central1-aiplatform.googleapis.com/v1/publishers/google')
    })

    it('throws when a Vertex-resolved provider lacks iam-gcp auth config', async () => {
      getAuthConfigMock.mockResolvedValue(null)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] })

      await expect(providerToAiSdkConfig(provider, model)).rejects.toThrow(
        'VertexAI requires iam-gcp auth configuration.'
      )
    })
  })

  describe('Bedrock row', () => {
    it('routes a bedrock-resolved provider to buildBedrockConfig (iam-aws region/keys)', async () => {
      getAuthConfigMock.mockResolvedValue({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret'
      })
      const provider = makeProvider({
        id: 'bedrock',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
            adapterFamily: 'bedrock'
          }
        }
      })
      const model = makeModel({
        id: 'bedrock::claude',
        apiModelId: 'anthropic.claude-3',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('bedrock')
      expect(settings.region).toBe('us-east-1')
      expect(settings.accessKeyId).toBe('AKIA')
      expect(settings.secretAccessKey).toBe('secret')
      // getAuthConfig is consulted for bedrock credentials.
      expect(getAuthConfigMock).toHaveBeenCalledWith('bedrock')
    })
  })

  describe('generic / openai-compatible fallback', () => {
    it('falls back to buildOpenAICompatibleConfig for an unknown openai-compatible provider', async () => {
      // No adapterFamily → resolveAiSdkProviderId returns 'openai-compatible',
      // which matches no builder row and is excluded from the generic branch.
      const provider = makeProvider({
        id: 'some-relay',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://relay.example.com/v1'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('openai-compatible')
      expect(settings.name).toBe('some-relay')
      expect(settings.apiKey).toBe('sk-test-key')
      // No Vertex leakage into the generic fallback.
      expect(settings.project).toBeUndefined()
      expect(settings.location).toBeUndefined()
      expect(settings.googleCredentials).toBeUndefined()
    })

    it('routes a core-registered adapter (deepseek) to buildGenericProviderConfig', async () => {
      // deepseek has a registered ai-core provider config (hasProviderConfig true)
      // and is not 'openai-compatible', so it takes the generic branch — not the
      // openai-compatible fallback — and the config providerId stays 'deepseek'.
      const provider = makeProvider({
        id: 'deepseek',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.deepseek.com/v1',
            adapterFamily: 'deepseek'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)

      expect(config.providerId).toBe('deepseek')
      expect((config.providerSettings as Record<string, unknown>).apiKey).toBe('sk-test-key')
    })
  })
})
