import { validateFileName } from '@shared/utils/file'

export function getInitialNoteTitle(content: string): string {
  if (!content.includes('\n')) return ''

  const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return validateFileName(firstLine).valid ? firstLine : ''
}
