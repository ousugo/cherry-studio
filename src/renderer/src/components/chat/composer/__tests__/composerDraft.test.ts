import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import { serializeComposerDocument, toLegacyComposerPayload } from '../composerDraft'
import { COMPOSER_TOKEN_NODE_NAME } from '../ComposerTokenNode'

function tokenNode(attrs: Record<string, unknown>): JSONContent {
  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs
  }
}

describe('composer draft serialization', () => {
  it('serializes tokens before, between, and after text in document order', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({ id: 'browser', kind: 'skill', label: 'Browser', payload: { skillId: 'browser' } }),
            { type: 'text', text: ' open ' },
            tokenNode({ id: 'computer', kind: 'environment', label: '电脑' }),
            { type: 'text', text: ' edit ' },
            tokenNode({
              id: 'chat.ts',
              kind: 'file',
              label: 'chat.ts',
              promptText: 'src/chat.ts',
              payload: { path: 'src/chat.ts' }
            })
          ]
        }
      ]
    })

    expect(draft.text).toBe(' open  edit src/chat.ts')
    expect(draft.tokens).toMatchObject([
      { id: 'browser', kind: 'skill', label: 'Browser', index: 0, textOffset: 0 },
      { id: 'computer', kind: 'environment', label: '电脑', index: 1, textOffset: 6 },
      { id: 'chat.ts', kind: 'file', label: 'chat.ts', index: 2, textOffset: 12 }
    ])
  })

  it('does not leak token labels into prompt text by default', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Use ' },
            tokenNode({ id: 'model-1', kind: 'model', label: '5.5 超高' }),
            { type: 'text', text: ' please' }
          ]
        }
      ]
    })

    expect(draft.text).toBe('Use  please')
    expect(draft.tokens[0]).toMatchObject({ kind: 'model', label: '5.5 超高', textOffset: 4 })
  })

  it('keeps plain pasted text as text, not tokens', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Browser 电脑 chat.ts' }]
        }
      ]
    })

    expect(draft).toEqual({ text: 'Browser 电脑 chat.ts', tokens: [] })
  })

  it('bridges file model skill and command tokens to the legacy payload shape', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            tokenNode({ id: 'file-1', kind: 'file', label: 'chat.ts', payload: { path: 'src/chat.ts' } }),
            tokenNode({ id: 'model-1', kind: 'model', label: '5.5', payload: { modelId: 'gpt-5.5' } }),
            tokenNode({ id: 'skill-1', kind: 'skill', label: 'Browser', payload: { skillId: 'browser' } }),
            tokenNode({ id: 'cmd-1', kind: 'command', label: '/plan', payload: { command: 'plan' } })
          ]
        }
      ]
    })

    expect(toLegacyComposerPayload(draft)).toMatchObject({
      text: '',
      files: [{ path: 'src/chat.ts' }],
      mentionedModels: [{ modelId: 'gpt-5.5' }],
      mentionedSkills: [{ skillId: 'browser' }],
      commands: [{ command: 'plan' }]
    })
  })
})
