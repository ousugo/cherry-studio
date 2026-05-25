/**
 * Streaming markdown renderer.
 *
 * Builds on `MarkdownCore` and splices a per-`id` `createAnimatePlugin`
 * instance into the rehype pipeline so already-rendered text does NOT
 * re-fade when the AST changes shape mid-stream (e.g. `**bold` becomes
 * `<strong>` when the closing fence arrives). See `hooks.ts` for the
 * lifecycle rationale.
 *
 * The animation defaults to `blurIn @ 250ms ease-out` — Streamdown's
 * recommended config for fast token streams (per its docs page). Pass
 * `animated={false}` to disable animation entirely.
 */

import type { AnimateOptions, Components, PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { useAnimatePluginHandle, useCommitAnimateAfterRender } from './hooks'
import { MarkdownCore } from './internal'

export interface StreamingMarkdownProps {
  /** Stable identity used as heading-ID prefix + animate plugin keying. */
  id: string
  /** Markdown source (the streaming tail). */
  children: string
  components?: Partial<Components>
  plugins?: PluginConfig
  rehypePlugins?: Pluggable[]
  remarkPlugins?: Pluggable[]
  disallowedElements?: readonly string[]
  className?: string
  footnoteLabel?: string
  /**
   * Animation configuration. Pass `false` to disable (no rehype animate
   * plugin — useful when a caller wants a caret-only typewriter feel).
   * Defaults to `{ animation: 'blurIn', duration: 250, easing: 'ease-out' }`.
   */
  animated?: false | AnimateOptions
  /**
   * If true, Streamdown repairs half-typed markdown at the tail (its
   * default in streaming mode). Set false to disable.
   */
  parseIncompleteMarkdown?: boolean
}

export function StreamingMarkdown({
  id,
  children,
  components,
  plugins,
  rehypePlugins,
  remarkPlugins,
  disallowedElements,
  className,
  footnoteLabel,
  animated,
  parseIncompleteMarkdown = true
}: StreamingMarkdownProps) {
  const animationDisabled = animated === false
  const handle = useAnimatePluginHandle(id, animationDisabled ? undefined : animated)
  useCommitAnimateAfterRender(handle, children)

  return (
    <MarkdownCore
      id={id}
      mode="streaming"
      parseIncompleteMarkdown={parseIncompleteMarkdown}
      components={components}
      plugins={plugins}
      extraRehypePlugins={rehypePlugins}
      extraRemarkPlugins={remarkPlugins}
      animatePlugin={animationDisabled ? undefined : handle.plugin.rehypePlugin}
      disallowedElements={disallowedElements}
      className={className}
      footnoteLabel={footnoteLabel}>
      {children}
    </MarkdownCore>
  )
}
