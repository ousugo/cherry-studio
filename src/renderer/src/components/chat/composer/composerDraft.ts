import type { Editor, JSONContent } from '@tiptap/core'

import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

type ComposerSerializableSource = Pick<Editor, 'getJSON'> | JSONContent

export interface LegacyComposerPayload {
  text: string
  tokens: readonly ComposerSerializedToken[]
  files?: readonly unknown[]
  mentionedModels?: readonly unknown[]
  mentionedSkills?: readonly unknown[]
  commands?: readonly unknown[]
}

function isEditorSource(source: ComposerSerializableSource): source is Pick<Editor, 'getJSON'> {
  return typeof (source as Pick<Editor, 'getJSON'>).getJSON === 'function'
}

function appendTokenPayload(target: unknown[], token: ComposerSerializedToken) {
  target.push(token.payload ?? token)
}

export function serializeComposerDocument(source: ComposerSerializableSource): ComposerSerializedDraft {
  const json = isEditorSource(source) ? source.getJSON() : source
  const tokens: ComposerSerializedToken[] = []
  let text = ''

  const visitNode = (node: JSONContent) => {
    if (node.type === 'text') {
      text += node.text ?? ''
      return
    }

    if (node.type === 'hardBreak') {
      text += '\n'
      return
    }

    if (node.type === COMPOSER_TOKEN_NODE_NAME) {
      const token = normalizeComposerTokenAttrs(node.attrs ?? {})
      tokens.push({
        ...token,
        index: tokens.length,
        textOffset: text.length
      })
      text += token.promptText ?? ''
      return
    }

    if (!node.content?.length) return

    if (node.type === 'doc') {
      node.content.forEach((child, index) => {
        if (index > 0) text += '\n'
        visitNode(child)
      })
      return
    }

    node.content.forEach(visitNode)
  }

  visitNode(json)

  return { text, tokens }
}

export function toLegacyComposerPayload(draft: ComposerSerializedDraft): LegacyComposerPayload {
  const files: unknown[] = []
  const mentionedModels: unknown[] = []
  const mentionedSkills: unknown[] = []
  const commands: unknown[] = []

  for (const token of draft.tokens) {
    switch (token.kind) {
      case 'file':
        appendTokenPayload(files, token)
        break
      case 'model':
        appendTokenPayload(mentionedModels, token)
        break
      case 'skill':
        appendTokenPayload(mentionedSkills, token)
        break
      case 'command':
        appendTokenPayload(commands, token)
        break
    }
  }

  return {
    text: draft.text,
    tokens: draft.tokens,
    ...(files.length > 0 && { files }),
    ...(mentionedModels.length > 0 && { mentionedModels }),
    ...(mentionedSkills.length > 0 && { mentionedSkills }),
    ...(commands.length > 0 && { commands })
  }
}
