import type { CherryMessagePart } from '@shared/data/types/message'
import type { CherryProviderMetadata, ComposerMessageSnapshot } from '@shared/data/types/uiParts'
import type { Editor, JSONContent } from '@tiptap/core'

import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerSerializedDraft, ComposerSerializedToken } from './tokens'
import { normalizeComposerTokenAttrs } from './tokens'

const COMPOSER_MESSAGE_SNAPSHOT_VERSION = 1

type ComposerSerializableSource = Pick<Editor, 'getJSON'> | JSONContent

interface ComposerFilePartSource {
  path?: string
  url?: string
  ext?: string
  name?: string
  origin_name?: string
}

function isEditorSource(source: ComposerSerializableSource): source is Pick<Editor, 'getJSON'> {
  return typeof (source as Pick<Editor, 'getJSON'>).getJSON === 'function'
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

export function createComposerMessageSnapshot(draft: ComposerSerializedDraft): ComposerMessageSnapshot | undefined {
  if (draft.tokens.length === 0) return undefined

  return {
    version: COMPOSER_MESSAGE_SNAPSHOT_VERSION,
    tokens: draft.tokens.map(({ id, kind, label, icon, description, index, textOffset, promptText }) => ({
      id,
      kind,
      label,
      ...(icon && { icon }),
      ...(description && { description }),
      index,
      textOffset,
      ...(promptText && { promptText })
    }))
  }
}

function createComposerTextPart(text: string, composer?: ComposerMessageSnapshot): CherryMessagePart {
  if (!composer) return { type: 'text', text } as CherryMessagePart

  const cherry: CherryProviderMetadata = { composer }
  return {
    type: 'text',
    text,
    providerMetadata: {
      cherry
    }
  } as unknown as CherryMessagePart
}

function createComposerFilePart(file: ComposerFilePartSource): CherryMessagePart | undefined {
  const url = file.path ?? file.url
  if (!url) return undefined

  return {
    type: 'file',
    url,
    mediaType: file.ext ?? 'application/octet-stream',
    filename: file.origin_name ?? file.name
  } as CherryMessagePart
}

export function createComposerUserMessageParts(
  draft: ComposerSerializedDraft,
  options: { files?: readonly ComposerFilePartSource[] } = {}
): CherryMessagePart[] {
  const parts: CherryMessagePart[] = [createComposerTextPart(draft.text, createComposerMessageSnapshot(draft))]

  for (const file of options.files ?? []) {
    const filePart = createComposerFilePart(file)
    if (filePart) parts.push(filePart)
  }

  return parts
}
