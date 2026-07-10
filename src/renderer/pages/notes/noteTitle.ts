import { isMac, isWin } from '@renderer/utils/platform'
import { validateFileName } from '@shared/utils/file'

const FILENAME_PLATFORM: NodeJS.Platform = isWin ? 'win32' : isMac ? 'darwin' : 'linux'
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\x00-\x1f]/g

export function getInitialNoteTitle(content: string): string {
  if (!content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const sanitizedTitle = firstLine.replace(INVALID_FILENAME_CHARACTERS, '').replace(/[\s.]+$/, '')
  return validateFileName(sanitizedTitle, FILENAME_PLATFORM).valid ? sanitizedTitle : ''
}
