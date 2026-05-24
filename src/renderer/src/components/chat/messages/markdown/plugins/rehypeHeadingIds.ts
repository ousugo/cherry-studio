// Re-export shim: implementation lives in @cherrystudio/ui/composites/markdown
// since the markdown package extraction (PR 1). This file is kept so existing
// `from './plugins/rehypeHeadingIds'` imports compile unchanged. It will be
// deleted in PR 4 along with the Markdown.tsx cutover.
import { rehypeHeadingIds } from '@cherrystudio/ui/composites/markdown'

export { createSlugger, extractTextFromNode } from '@cherrystudio/ui/composites/markdown'
export default rehypeHeadingIds
