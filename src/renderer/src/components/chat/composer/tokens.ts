export const COMPOSER_DRAFT_TOKEN_KINDS = [
  'skill',
  'file',
  'command',
  'model',
  'knowledge',
  'mcpPrompt',
  'mcpResource',
  'reference',
  'environment'
] as const

export type ComposerDraftTokenKind = (typeof COMPOSER_DRAFT_TOKEN_KINDS)[number]

export interface ComposerDraftToken {
  id: string
  kind: ComposerDraftTokenKind
  label: string
  icon?: string
  description?: string
  promptText?: string
  payload?: unknown
}

export interface ComposerSerializedToken extends ComposerDraftToken {
  index: number
  textOffset: number
}

export interface ComposerSerializedDraft {
  text: string
  tokens: ComposerSerializedToken[]
}

export function isComposerDraftTokenKind(value: unknown): value is ComposerDraftTokenKind {
  return typeof value === 'string' && COMPOSER_DRAFT_TOKEN_KINDS.includes(value as ComposerDraftTokenKind)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readPayload(value: unknown): unknown | undefined {
  return value == null ? undefined : value
}

export function normalizeComposerTokenAttrs(attrs: Record<string, unknown>): ComposerDraftToken {
  const kindValue = attrs.kind
  const label = readString(attrs.label) ?? ''
  const payload = readPayload(attrs.payload)

  return {
    id: readString(attrs.id) ?? label,
    kind: isComposerDraftTokenKind(kindValue) ? kindValue : 'reference',
    label,
    ...(readString(attrs.icon) && { icon: readString(attrs.icon) }),
    ...(readString(attrs.description) && { description: readString(attrs.description) }),
    ...(readString(attrs.promptText) && { promptText: readString(attrs.promptText) }),
    ...(payload !== undefined && { payload })
  }
}
