import type { JSONContent } from '@tiptap/core'

import {
  type ComposerTokenMarkerRule,
  createComposerPlainTextContent,
  createComposerTokenMarkerInlineContent
} from './composerTokenMarkers'
import { createPromptVariableMarkerRule } from './promptVariables'
import type { ComposerDraftToken } from './tokens'

interface ComposerPlainTextPasteOptions {
  pasteLongTextAsFile?: boolean
  pasteLongTextThreshold?: number
  promptVariableStartIndex?: number
  resolveSkillMarker?: (marker: string) => ComposerDraftToken | null | undefined
}

const SKILL_TOKEN_MARKER_PATTERN = /(^|\s)\/([^/\s]+)\/(?=$|\s)/g

function createSkillMarkerRule(
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
): ComposerTokenMarkerRule {
  return {
    id: 'skill',
    pattern: SKILL_TOKEN_MARKER_PATTERN,
    resolve: (match) => {
      const prefix = match[1] ?? ''
      const marker = match[2]
      const index = match.index ?? 0
      if (!marker) return null

      const token = resolveSkillMarker(marker)
      if (!token) return null

      const markerStart = index + prefix.length
      return { from: markerStart, to: markerStart + marker.length + 2, token }
    }
  }
}

export function createComposerPlainTextPasteContent(text: string): JSONContent[] {
  return createComposerPlainTextContent(text)
}

export function createComposerMarkedTextPasteContent(
  text: string,
  resolveSkillMarker: NonNullable<ComposerPlainTextPasteOptions['resolveSkillMarker']>
): JSONContent[] | null {
  const result = createComposerTokenMarkerInlineContent(text, [createSkillMarkerRule(resolveSkillMarker)])

  return result.hasToken ? result.content : null
}

function createPlainTextPasteMarkerRules(options: ComposerPlainTextPasteOptions): ComposerTokenMarkerRule[] {
  const rules = [createPromptVariableMarkerRule({ startIndex: options.promptVariableStartIndex ?? 0 })]

  if (options.resolveSkillMarker) {
    rules.push(createSkillMarkerRule(options.resolveSkillMarker))
  }

  return rules
}

export function getComposerPlainTextPasteOverride(text: string, options: ComposerPlainTextPasteOptions) {
  if (!text) return null

  if (options.pasteLongTextAsFile && options.pasteLongTextThreshold && text.length > options.pasteLongTextThreshold) {
    return null
  }

  const markedTextContent = createComposerTokenMarkerInlineContent(text, createPlainTextPasteMarkerRules(options))
  if (markedTextContent.hasToken) return markedTextContent.content

  return createComposerPlainTextPasteContent(text)
}
