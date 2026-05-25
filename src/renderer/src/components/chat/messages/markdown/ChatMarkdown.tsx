/**
 * Chat-side composition over `@cherrystudio/ui/composites/markdown`.
 *
 * - Picks `Markdown` (static) vs `StreamingMarkdown` based on `block.status`.
 * - Supplies chat-flavored components via `useChatMarkdownComponents`.
 * - Wires `withChatPlugins` preset (code + cjk + math + mermaid) gated on
 *   the user's `mathEnableSingleDollar` preference.
 * - Handles the "paused with empty content" UX (renders the localized
 *   placeholder) and footnote-label translation.
 *
 * This wrapper replaces the old `Markdown.tsx` monolith. Behaviour is
 * intentionally the same; the AST-stability mechanism (per-id animate
 * plugin with setPrevContentLength) is the only behavioural change, and it
 * lives in the generic `<StreamingMarkdown>` upstream.
 */

import { Markdown, type MarkdownSource, StreamingMarkdown, withChatPlugins } from '@cherrystudio/ui/composites/markdown'
import { useMessageRenderConfig } from '@renderer/components/chat/messages/MessageListProvider'
import { isEmpty } from 'lodash'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useChatMarkdownComponents } from './useChatMarkdownComponents'

interface Props {
  block: MarkdownSource
  /** Pre-process the markdown content (e.g. citation tag injection). */
  postProcess?: (text: string) => string
}

const STYLE_ELEMENT_REGEX = /<style\b[^>]*>/i

const ChatMarkdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'

  const plugins = useMemo(() => withChatPlugins({ singleDollarMath: mathEnableSingleDollar }), [mathEnableSingleDollar])

  // Preserve the chat-specific "paused with empty content" placeholder. The
  // generic Markdown components don't know about i18n; we resolve the
  // localized string here and short-circuit to it.
  const content = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    return postProcess ? postProcess(block.content) : block.content
  }, [block.status, block.content, postProcess, t])

  const hasStyleElement = STYLE_ELEMENT_REGEX.test(content)
  const components = useChatMarkdownComponents({ blockId: block.id, hasStyleElement })

  const footnoteLabel = t('common.footnotes')

  if (isStreaming) {
    return (
      <StreamingMarkdown id={block.id} plugins={plugins} components={components} footnoteLabel={footnoteLabel}>
        {content}
      </StreamingMarkdown>
    )
  }
  return (
    <Markdown id={block.id} plugins={plugins} components={components} footnoteLabel={footnoteLabel}>
      {content}
    </Markdown>
  )
}

export default ChatMarkdown
