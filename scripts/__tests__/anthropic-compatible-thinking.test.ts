import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { describe, expect, it } from 'vitest'

type CapturedRequest = {
  body?: Record<string, unknown>
}

const createModel = (modelId: string, captured: CapturedRequest) =>
  new AnthropicMessagesLanguageModel(modelId as any, {
    provider: 'test.anthropic',
    baseURL: 'https://example.com',
    headers: () => ({ 'x-api-key': 'test-key' }),
    supportedUrls: () => ({}),
    fetch: async (_url, init) => {
      captured.body = JSON.parse(String(init?.body))

      return new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: modelId,
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 1
          }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    }
  })

const generateWithThinkingAndSampling = async (modelId: string) => {
  const captured: CapturedRequest = {}
  const model = createModel(modelId, captured)

  await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxOutputTokens: 128,
    temperature: 0.3,
    topK: 40,
    topP: 0.9,
    providerOptions: {
      anthropic: {
        thinking: { type: 'adaptive' }
      }
    }
  })

  return captured.body
}

describe('@ai-sdk/anthropic compatible thinking patch', () => {
  it('keeps sampling parameters for Anthropic-compatible non-Claude models', async () => {
    const body = await generateWithThinkingAndSampling('MiniMax-M3')

    expect(body).toMatchObject({
      model: 'MiniMax-M3',
      max_tokens: 128,
      temperature: 0.3,
      top_k: 40,
      top_p: 0.9,
      thinking: { type: 'adaptive' }
    })
  })

  it('keeps Claude native sampling guard when thinking is enabled', async () => {
    const body = await generateWithThinkingAndSampling('claude-3-7-sonnet-latest')

    expect(body).toMatchObject({
      model: 'claude-3-7-sonnet-latest',
      max_tokens: 128,
      thinking: { type: 'adaptive' }
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('top_p')
  })
})
