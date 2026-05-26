import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'

import {
  createComposerMessageSnapshot,
  createComposerUserMessageParts,
  serializeComposerDocument
} from '../composerDraft'
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

  it('creates a display-only composer snapshot without token payload objects', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open ' },
            tokenNode({
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              promptText: 'src/chat.ts',
              payload: { path: 'src/chat.ts' }
            })
          ]
        }
      ]
    })

    expect(createComposerMessageSnapshot(draft)).toEqual({
      version: 1,
      tokens: [
        {
          id: 'file-1',
          kind: 'file',
          label: 'chat.ts',
          index: 0,
          textOffset: 5,
          promptText: 'src/chat.ts'
        }
      ]
    })
  })

  it('filters model tokens out of persisted composer metadata', () => {
    expect(
      createComposerMessageSnapshot({
        text: 'Ask docs',
        tokens: [
          { id: 'model-1', kind: 'model', label: 'GPT', index: 0, textOffset: 0 },
          { id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 1, textOffset: 4 }
        ]
      })
    ).toEqual({
      version: 1,
      tokens: [{ id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 1, textOffset: 4 }]
    })

    expect(
      createComposerMessageSnapshot({
        text: 'Ask',
        tokens: [{ id: 'model-1', kind: 'model', label: 'GPT', index: 0, textOffset: 0 }]
      })
    ).toBeUndefined()
  })

  it('builds user message parts with composer metadata and file parts', () => {
    const draft = serializeComposerDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            tokenNode({ id: 'kb-1', kind: 'knowledge', label: 'Docs', payload: { id: 'kb-1' } })
          ]
        }
      ]
    })

    expect(
      createComposerUserMessageParts(draft, {
        files: [{ path: '/tmp/notes.md', name: 'notes.md', origin_name: 'notes.md', ext: '.md' }]
      })
    ).toEqual([
      {
        type: 'text',
        text: 'Read ',
        providerMetadata: {
          cherry: {
            composer: {
              version: 1,
              tokens: [{ id: 'kb-1', kind: 'knowledge', label: 'Docs', index: 0, textOffset: 5 }]
            }
          }
        }
      },
      {
        type: 'file',
        url: '/tmp/notes.md',
        mediaType: '.md',
        filename: 'notes.md'
      }
    ])
  })
})
