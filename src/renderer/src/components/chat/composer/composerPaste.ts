import type { JSONContent } from '@tiptap/core'

import { COMPOSER_TOKEN_NODE_NAME } from './ComposerTokenNode'
import type { ComposerDraftToken } from './tokens'

interface ComposerPlainTextPasteOptions {
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
  resolveSkillMarker?: (marker: string) => ComposerDraftToken | null | undefined
}

const LINE_BREAK_PATTERN = /\r\n?|\n/
const SKILL_TOKEN_MARKER_PATTERN = /(^|\s)\/([^/\s]+)\/(?=$|\s)/g

function createSkillTokenContent(token: ComposerDraftToken): JSONContent {
  return {
    type: COMPOSER_TOKEN_NODE_NAME,
    attrs: token
  }
}

function appendMarkedSkillTokenContent(
  nodes: JSONContent[],
  line: string,
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
) {
  let cursor = 0
  let hasMarker = false

  for (const match of line.matchAll(SKILL_TOKEN_MARKER_PATTERN)) {
    const prefix = match[1] ?? ''
    const marker = match[2]
    const index = match.index ?? 0
    if (!marker) continue

    const token = resolveSkillMarker(marker)
    if (!token) continue

    const markerStart = index + prefix.length
    if (markerStart > cursor) nodes.push({ type: 'text', text: line.slice(cursor, markerStart) })
    nodes.push(createSkillTokenContent(token))
    cursor = markerStart + marker.length + 2
    hasMarker = true
  }

  if (!hasMarker) return false
  if (cursor < line.length) nodes.push({ type: 'text', text: line.slice(cursor) })
  return true
}

export function createComposerPlainTextPasteContent(text: string): JSONContent[] {
  return text.split(LINE_BREAK_PATTERN).flatMap<JSONContent>((line, index) => {
    const nodes: JSONContent[] = []
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (line) nodes.push({ type: 'text', text: line })
    return nodes
  })
}

export function createComposerMarkedTextPasteContent(
  text: string,
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
): JSONContent[] | null {
  let hasMarker = false
  const content = text.split(LINE_BREAK_PATTERN).flatMap<JSONContent>((line, index) => {
    const nodes: JSONContent[] = []
    if (index > 0) nodes.push({ type: 'hardBreak' })
    if (appendMarkedSkillTokenContent(nodes, line, resolveSkillMarker)) {
      hasMarker = true
      return nodes
    }
    if (line) nodes.push({ type: 'text', text: line })
    return nodes
  })

  return hasMarker ? content : null
}

export function getComposerPlainTextPasteOverride(text: string, options: ComposerPlainTextPasteOptions) {
  if (!text) return null

  if (options.pasteLongTextAsFile && options.pasteLongTextThreshold && text.length > options.pasteLongTextThreshold) {
    return null
  }

  if (options.resolveSkillMarker) {
    const markedTextContent = createComposerMarkedTextPasteContent(text, options.resolveSkillMarker)
    if (markedTextContent) return markedTextContent
  }

  return createComposerPlainTextPasteContent(text)
}
