export function getInitialNoteTitle(content: string): string {
  return content.split(/\r?\n/, 1)[0]?.trim() ?? ''
}
