import { type Model, MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { canModelUseAssistantWebSearch, reconcileWebSearchForModel } from '../modelReconcile'

const createModel = (capabilities: ModelCapability[] = []): Model => ({
  id: 'provider::model',
  providerId: 'provider',
  apiModelId: 'model',
  name: 'Model',
  capabilities,
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

describe('modelReconcile web search', () => {
  it('rejects enabled web search when the next model cannot consume it', () => {
    const nextModel = createModel()

    expect(canModelUseAssistantWebSearch(nextModel, { toolUseMode: 'function' })).toBe(false)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true, toolUseMode: 'function' })).toEqual({
      enableWebSearch: false
    })
  })

  it('keeps enabled web search for function-calling models', () => {
    const nextModel = createModel([MODEL_CAPABILITY.FUNCTION_CALL])

    expect(canModelUseAssistantWebSearch(nextModel, { toolUseMode: 'function' })).toBe(true)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true, toolUseMode: 'function' })).toBeNull()
  })

  it('keeps enabled web search in prompt tool mode', () => {
    const nextModel = createModel()

    expect(canModelUseAssistantWebSearch(nextModel, { toolUseMode: 'prompt' })).toBe(true)
    expect(reconcileWebSearchForModel(nextModel, { enableWebSearch: true, toolUseMode: 'prompt' })).toBeNull()
  })
})
