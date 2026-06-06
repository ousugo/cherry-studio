export type FileSizeState = { status: 'pending' } | { status: 'ok'; size: number } | { status: 'error' }

export function useFileSize(
  _workspacePath: string | null | undefined,
  _filePath: string | null | undefined
): FileSizeState {
  return { status: 'ok', size: 0 }
}
