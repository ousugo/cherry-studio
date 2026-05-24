/**
 * Public barrel for the generic markdown composites.
 *
 * Phase 1 (PR 1): types, context, utility helpers, and rehype plugins.
 * Phase 2 (PR 4): `<Markdown>` and `<StreamingMarkdown>` components.
 *
 * Consumers in the chat layer continue importing through legacy paths
 * (`@renderer/utils/markdown`, `@renderer/utils/formats`, the inline helpers
 * in `Markdown.tsx`); those paths are re-export shims that delegate here.
 */

export { MarkdownBlockContext, type MarkdownBlockContextValue, useMarkdownBlockContext } from './context'
export * from './plugins'
export type { MarkdownSource, MarkdownStatus } from './types'
export * from './utils'
