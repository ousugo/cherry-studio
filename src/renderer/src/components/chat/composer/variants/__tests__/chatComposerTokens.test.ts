import type { FileMetadata, KnowledgeBase } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  chatComposerTokenId,
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken,
  modelToComposerToken
} from '../chatComposerTokens'

describe('chat composer token mapping', () => {
  it('maps files, knowledge bases, and models to stable composer token ids', () => {
    const file = {
      id: 'file-1',
      name: 'chat.ts',
      origin_name: 'chat.ts',
      path: '/tmp/chat.ts'
    } as FileMetadata
    const knowledgeBase = { id: 'kb-1', name: 'Docs' } as KnowledgeBase
    const model = { id: 'model-1', name: 'GPT 5.5' } as unknown as Model

    expect(fileToComposerToken(file)).toMatchObject({
      id: 'file:file-1',
      kind: 'file',
      label: 'chat.ts',
      payload: file
    })
    expect(knowledgeBaseToComposerToken(knowledgeBase)).toMatchObject({
      id: 'knowledge:kb-1',
      kind: 'knowledge',
      label: 'Docs',
      payload: knowledgeBase
    })
    expect(modelToComposerToken(model)).toMatchObject({
      id: 'model:model-1',
      kind: 'model',
      label: 'GPT 5.5',
      payload: model
    })
  })

  it('falls back to file path when file id is missing', () => {
    const file = { id: '', path: '/tmp/fallback.txt' } as FileMetadata

    expect(chatComposerTokenId.file(file)).toBe('file:/tmp/fallback.txt')
  })

  it('extracts token ids by kind', () => {
    const ids = getComposerTokenIds(
      [
        { id: 'file:file-1', kind: 'file', label: 'chat.ts', index: 0, textOffset: 0 },
        { id: 'model:model-1', kind: 'model', label: 'GPT 5.5', index: 1, textOffset: 0 }
      ],
      'file'
    )

    expect(ids).toEqual(new Set(['file:file-1']))
  })
})
