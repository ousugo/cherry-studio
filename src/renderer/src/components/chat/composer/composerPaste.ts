import type { JSONContent } from '@tiptap/core'

interface ComposerPlainTextPasteOptions {
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
}

const LINE_BREAK_PATTERN = /\r\n?|\n/

export function createComposerPlainTextPasteContent(text: string): JSONContent[] {
  return text.split(LINE_BREAK_PATTERN).flatMap<JSONContent>((line, index) => {
    const nodes: JSONContent[] = []
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
    return nodes
  })
}

export function getComposerPlainTextPasteOverride(text: string, options: ComposerPlainTextPasteOptions) {
  if (!text) return null

  if (options.pasteLongTextAsFile && options.pasteLongTextThreshold && text.length > options.pasteLongTextThreshold) {
    return null
  }

  return createComposerPlainTextPasteContent(text)
}
