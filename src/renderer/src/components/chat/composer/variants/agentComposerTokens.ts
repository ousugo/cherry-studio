import type { FileMetadata } from '@renderer/types'

import type { ComposerDraftToken, ComposerSerializedToken } from '../tokens'

export const agentComposerTokenId = {
  file: (file: Pick<FileMetadata, 'id' | 'path'>) => `file:${file.id || file.path}`
}

export function agentFileToComposerToken(file: FileMetadata): ComposerDraftToken {
  return {
    id: agentComposerTokenId.file(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
}

export function getAgentComposerTokenIds(
  tokens: readonly ComposerSerializedToken[],
  kind?: ComposerDraftToken['kind']
) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}
