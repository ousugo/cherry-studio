import type { ReasoningWireProfile } from '../schemas/reasoningWire'
import { defineProvider } from './types'
import { modeWire } from './wires'

const openAIThinkingWire: ReasoningWireProfile = modeWire('chat_template_kwargs.enable_thinking', {
  off: false,
  auto: true
})

export default defineProvider({
  id: 'dots',
  name: 'Dots Studio',
  defaultChatEndpoint: 'openai-chat-completions',
  modelListSource: 'registry',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      dialect: { streamOptions: false },
      reasoningFormat: { type: 'openai-chat', wire: openAIThinkingWire }
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://note3-prev-api.askdiandian.com',
      reasoningFormat: { type: 'anthropic' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://dots.ai/platform/apikeys',
      docs: 'https://dots.ai/platform/docs',
      models: 'https://huggingface.co/dots-studio/dots3-note-prev',
      official: 'https://dots.ai/'
    }
  },
  overrides: [
    {
      modelId: 'dots-3-note-preview',
      apiModelId: 'dots3-note-prev',
      endpointTypes: ['openai-chat-completions', 'anthropic-messages'],
      parameterSupport: {
        temperature: { supported: true },
        topP: { supported: true },
        topK: { supported: false },
        frequencyPenalty: false,
        presencePenalty: false,
        maxTokens: true,
        stopSequences: true,
        systemMessage: true
      }
    }
  ]
})
