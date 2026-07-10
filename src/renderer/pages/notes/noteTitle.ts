import { isMac, isWin } from '@renderer/utils/platform'
import { validateFileName } from '@shared/utils/file'

const FILENAME_PLATFORM: NodeJS.Platform = isWin ? 'win32' : isMac ? 'darwin' : 'linux'

export function getInitialNoteTitle(content: string): string {
  if (!content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return validateFileName(firstLine, FILENAME_PLATFORM).valid ? firstLine : ''
}
