import { replaceNonPortableFilenameCharacters, validateFileName } from '@shared/utils/file'

const MAX_INITIAL_NOTE_TITLE_LENGTH = 12
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function getInitialNoteTitle(content: string, allowIncompleteFirstLine = false): string {
  if (!allowIncompleteFirstLine && !content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const titleSegments: string[] = []
  for (const { segment } of GRAPHEME_SEGMENTER.segment(replaceNonPortableFilenameCharacters(firstLine, ''))) {
    titleSegments.push(segment)
    if (titleSegments.length === MAX_INITIAL_NOTE_TITLE_LENGTH) break
  }
  const truncatedTitle = titleSegments.join('').replace(/[\s.]+$/, '')
  return validateFileName(truncatedTitle, 'win32').valid ? truncatedTitle : ''
}
