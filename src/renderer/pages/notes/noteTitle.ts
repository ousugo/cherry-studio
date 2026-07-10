import { isMac, isWin } from '@renderer/utils/platform'
import { replaceNonPortableFilenameCharacters, validateFileName } from '@shared/utils/file'

const FILENAME_PLATFORM: NodeJS.Platform = isWin ? 'win32' : isMac ? 'darwin' : 'linux'

export function getInitialNoteTitle(content: string): string {
  if (!content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const sanitizedTitle = replaceNonPortableFilenameCharacters(firstLine, '').replace(/[\s.]+$/, '')
  return validateFileName(sanitizedTitle, FILENAME_PLATFORM).valid ? sanitizedTitle : ''
}
