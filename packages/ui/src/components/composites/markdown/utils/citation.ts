/**
 * Citation text-tag pipeline — converts source-specific citation marks in
 * markdown content into a uniform `[<sup data-citation='…'>N</sup>](url)`
 * tagged shape that the chat layer's `<a>` renderer can detect.
 *
 * Moved from `src/renderer/src/utils/citation.ts` as part of the markdown
 * package extraction. The chat layer's `Citation` and `WebSearchSource` types
 * are decoupled via structural local types so this module does not depend on
 * `@renderer/types` or `@google/genai`. Callers' chat-layer types are
 * structurally compatible and pass through unchanged.
 */

import { encodeHTML } from './text'

/**
 * Minimal structural type for a citation. Mirrors the chat layer's
 * `Citation` shape; chat-layer values pass through structurally.
 */
export interface CitationLike {
  number: number
  url?: string
  title?: string
  hostname?: string
  content?: string
  /** Provider-specific grounding metadata (e.g. Gemini groundingChunks). */
  metadata?: GroundingSupportLike[]
}

/**
 * Minimal subset of `@google/genai`'s `GroundingSupport` used by the Gemini
 * citation normalizer. Defined locally so the package does not pull the
 * Google AI SDK runtime.
 */
export interface GroundingSupportLike {
  groundingChunkIndices?: number[]
  segment?: {
    /** Byte offset of the segment end in the original Gemini response. */
    endIndex?: number
    /** Other segment fields (startIndex, text) the provider may include
     *  but the normalizer does not read. */
    [k: string]: unknown
  }
}

/**
 * Web-search source identifier. Stringly typed to accept any provider value
 * the caller passes; the normalizer switches on the canonical names below.
 */
export type WebSearchSource = string

export const WEB_SEARCH_SOURCE = {
  WEBSEARCH: 'websearch',
  OPENAI: 'openai',
  OPENAI_RESPONSE: 'openai-response',
  OPENROUTER: 'openrouter',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  PERPLEXITY: 'perplexity',
  QWEN: 'qwen',
  HUNYUAN: 'hunyuan',
  ZHIPU: 'zhipu',
  GROK: 'grok',
  AISDK: 'ai-sdk'
} as const

/**
 * Pick the first valid source identifier out of a citation-reference list.
 */
export function determineCitationSource(
  citationReferences: Array<{ citationBlockId?: string; citationBlockSource?: WebSearchSource }> | undefined
): WebSearchSource | undefined {
  if (citationReferences?.length) {
    const validReference = citationReferences.find((ref) => ref.citationBlockSource)
    return validReference?.citationBlockSource
  }
  return undefined
}

/**
 * Convert any source-specific citation marks in `content` into rendered
 * `[<sup data-citation='JSON'>N</sup>](url)` tags. Pipeline:
 *   1. Normalize source-specific marks (e.g. `[<sup>N</sup>](url)` → `[cite:N]`)
 *   2. Map `[cite:N]` → rendered tag via `generateCitationTag`
 */
export function withCitationTags(content: string, citations: CitationLike[], sourceType?: WebSearchSource): string {
  if (!content || citations.length === 0) return content
  // Note: callers are responsible for any presentation-layer cleanup of
  // `citation.content` (e.g. stripping markdown for the tooltip excerpt)
  // before passing the list in. That keeps this package free of UX
  // concerns like which characters look good inside a hover card.
  const citationMap = new Map(citations.map((c) => [c.number, c]))
  const normalizedContent = normalizeCitationMarks(content, citationMap, sourceType)
  return mapCitationMarksToTags(normalizedContent, citationMap)
}

/**
 * Normalize source-specific citation marks into the canonical `[cite:N]` form.
 * Code blocks are protected (a `[N]` in a code block is content, not a citation).
 */
export function normalizeCitationMarks(
  content: string,
  citationMap: Map<number, CitationLike>,
  sourceType?: WebSearchSource
): string {
  const codeBlockRegex = /```[\s\S]*?```|`[^`\n]*`/gm
  const skipRanges: Array<{ start: number; end: number }> = []

  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(content)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length })
  }

  const shouldSkip = (pos: number): boolean => {
    for (const range of skipRanges) {
      if (pos >= range.start && pos < range.end) return true
      if (range.start > pos) break
    }
    return false
  }

  const applyReplacements = (regex: RegExp, getReplacementFn: (m: RegExpExecArray) => string | null) => {
    const replacements: Array<{ start: number; end: number; replacement: string }> = []
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(content)) !== null) {
      if (!shouldSkip(m.index)) {
        const replacement = getReplacementFn(m)
        if (replacement !== null) {
          replacements.push({ start: m.index, end: m.index + m[0].length, replacement })
        }
      }
    }
    replacements.reverse().forEach(({ start, end, replacement }) => {
      content = content.slice(0, start) + replacement + content.slice(end)
    })
  }

  switch (sourceType) {
    case WEB_SEARCH_SOURCE.OPENAI:
    case WEB_SEARCH_SOURCE.OPENAI_RESPONSE:
    case WEB_SEARCH_SOURCE.PERPLEXITY: {
      applyReplacements(/\[<sup>(\d+)<\/sup>\]\([^)]*\)/g, (m) => {
        const citationNum = parseInt(m[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      break
    }
    case WEB_SEARCH_SOURCE.GEMINI: {
      const firstCitation = Array.from(citationMap.values())[0]
      if (firstCitation?.metadata) {
        const encoder = new TextEncoder()
        const contentBytes = encoder.encode(content)

        const byteOffsetToCharOffset = (byteOffset: number): number => {
          const decoder = new TextDecoder()
          return decoder.decode(contentBytes.slice(0, byteOffset)).length
        }

        const insertions: Array<{ position: number; tag: string }> = []
        firstCitation.metadata.forEach((support) => {
          if (!support.groundingChunkIndices || !support.segment) return
          const { endIndex } = support.segment
          if (endIndex == null) return

          const tag = support.groundingChunkIndices
            .map((citationNum) => {
              const citation = citationMap.get(citationNum + 1)
              return citation ? `[cite:${citationNum + 1}]` : ''
            })
            .filter(Boolean)
            .join('')

          if (tag) {
            insertions.push({ position: byteOffsetToCharOffset(endIndex), tag })
          }
        })

        insertions.sort((a, b) => b.position - a.position)
        for (const { position, tag } of insertions) {
          if (!shouldSkip(position)) {
            content = content.slice(0, position) + tag + content.slice(position)
          }
        }
      }
      break
    }
    case WEB_SEARCH_SOURCE.GROK: {
      applyReplacements(/\[\[(\d+)\]\]\([^)]*\)/g, (m) => {
        const citationNum = parseInt(m[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
      break
    }
    default: {
      applyReplacements(/\[(\d+)\]/g, (m) => {
        const citationNum = parseInt(m[1], 10)
        return citationMap.has(citationNum) ? `[cite:${citationNum}]` : null
      })
    }
  }

  return content
}

/** Map every `[cite:N]` mark to a rendered `[<sup>…</sup>](url)` tag. */
export function mapCitationMarksToTags(content: string, citationMap: Map<number, CitationLike>): string {
  return content.replace(/\[cite:(\d+)\]/g, (match, num) => {
    const citationNum = parseInt(num, 10)
    const citation = citationMap.get(citationNum)
    return citation ? generateCitationTag(citation) : match
  })
}

/** Build the rendered tag for a single citation. */
export function generateCitationTag(citation: CitationLike): string {
  const supData = {
    id: citation.number,
    url: citation.url,
    title: citation.title || citation.hostname || '',
    content: citation.content?.substring(0, 200)
  }
  // encodeHTML only escapes &, <, >, ", ' — also escape | so GFM tables
  // don't treat it as a column separator inside table cells
  const citationJson = encodeHTML(JSON.stringify(supData)).replace(/\|/g, '&#124;')

  const isLink = citation.url && citation.url.startsWith('http')
  // Escape | in URL to avoid breaking GFM table cell parsing
  const safeUrl = isLink && citation.url ? citation.url.replace(/\|/g, '%7C') : ''

  return `[<sup data-citation='${citationJson}'>${citation.number}</sup>]` + (isLink ? `(${safeUrl})` : '()')
}
