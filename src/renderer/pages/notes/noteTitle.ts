import { isMac, isWin } from '@renderer/utils/platform'
import { replaceNonPortableFilenameCharacters, validateFileName } from '@shared/utils/file'

const FILENAME_PLATFORM: NodeJS.Platform = isWin ? 'win32' : isMac ? 'darwin' : 'linux'
const MAX_INITIAL_NOTE_TITLE_LENGTH = 8
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function getInitialNoteTitle(content: string, allowIncompleteFirstLine = false): string {
  if (!allowIncompleteFirstLine && !content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const sanitizedTitle = replaceNonPortableFilenameCharacters(firstLine, '').replace(/[\s.]+$/, '')
  const truncatedTitle = Array.from(GRAPHEME_SEGMENTER.segment(sanitizedTitle), ({ segment }) => segment)
    .slice(0, MAX_INITIAL_NOTE_TITLE_LENGTH)
    .join('')
    .replace(/[\s.]+$/, '')
  return validateFileName(truncatedTitle, FILENAME_PLATFORM).valid ? truncatedTitle : ''
}
