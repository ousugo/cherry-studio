import type { FileMetadata } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { agentComposerTokenId, agentFileToComposerToken, getAgentComposerTokenIds } from '../agentComposerTokens'

describe('agent composer token mapping', () => {
  it('maps files to stable composer token ids', () => {
    const file = {
      id: 'file-1',
      name: 'agent.ts',
      origin_name: 'agent.ts',
      path: '/tmp/agent.ts'
    } as FileMetadata

    expect(agentFileToComposerToken(file)).toMatchObject({
      id: 'file:file-1',
      kind: 'file',
      label: 'agent.ts',
      payload: file
    })
  })

  it('falls back to file path when file id is missing', () => {
    const file = { id: '', path: '/tmp/fallback.txt' } as FileMetadata

    expect(agentComposerTokenId.file(file)).toBe('file:/tmp/fallback.txt')
  })

  it('extracts file token ids by kind', () => {
    const ids = getAgentComposerTokenIds(
      [
        { id: 'file:file-1', kind: 'file', label: 'agent.ts', index: 0, textOffset: 0 },
        { id: 'model:model-1', kind: 'model', label: 'GPT 5.5', index: 1, textOffset: 0 }
      ],
      'file'
    )

    expect(ids).toEqual(new Set(['file:file-1']))
  })
})
