/**
 * Decide which tools to defer (hide behind `tool_search`) for a given
 * request. Mirrors Claude Code's approach: tools are defer-eligible based
 * on a per-entry policy (`defer` field), and the auto pool collapses to
 * deferred when its inline cost would exceed a fraction of the model's
 * context window AND the trade is actually a net win.
 *
 * Threshold matches Claude Code's default (10% of context window). Hard-
 * coded for now; a Preference can wrap this if a real user need emerges.
 *
 * Two additional gates exist on top of the threshold because deferring is
 * NOT free — `applyDeferExposition` injects three meta-tools and a system
 * prompt section. Without these gates, small tool sets (and small-context
 * models) trigger defer, pay the meta-tools tax, and add extra LLM round
 * trips per tool use, for negative net savings:
 *
 *   - `MIN_AUTO_DEFER_COUNT`: defer only when the auto pool is large
 *     enough that search-then-invoke beats putting them all inline.
 *   - `META_TOOLS_OVERHEAD_TOKENS`: defer only when the estimated savings
 *     actually exceed the meta-tools' static cost.
 *
 * `always` entries bypass both gates — that policy was an explicit choice
 * (e.g. experimental tool / huge schema) and is not solely a token-cost
 * decision.
 */

import type { ToolEntry } from '../types'

const DEFER_THRESHOLD_PCT = 10
const FALLBACK_CONTEXT_WINDOW = 32_000
/** Rough chars-per-token ratio. Good enough for budget estimation; we don't need
 *  per-tokenizer accuracy because the threshold has a 10% safety margin baked in. */
const CHARS_PER_TOKEN = 4

/**
 * Static token cost of the three meta-tools (`tool_search`, `tool_inspect`,
 * `tool_invoke`) plus the `DEFERRED_TOOLS_HEADER` system-prompt section.
 * Sum of their descriptions + JSON-serialised input schemas, ÷ 4 chars/token.
 * Conservative — actual cost varies slightly with `<namespace>` lines but
 * stays within the same order of magnitude.
 */
const META_TOOLS_OVERHEAD_TOKENS = 500

/**
 * Minimum number of `auto` candidates that must exist before the pool can
 * collapse to deferred. Below this, the extra `tool_search → tool_invoke`
 * round trips per tool use cost more than just keeping the tools inline.
 */
const MIN_AUTO_DEFER_COUNT = 5

export interface ShouldDeferResult {
  /** Names of tools that should NOT appear in the inline ToolSet. */
  readonly deferredNames: ReadonlySet<string>
  /** Threshold derived from the model's context window. */
  readonly threshold: number
}

export function shouldDefer(entries: readonly ToolEntry[], contextWindow: number | undefined): ShouldDeferResult {
  const ctx = contextWindow && contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW
  const threshold = Math.floor(ctx * (DEFER_THRESHOLD_PCT / 100))

  const alwaysDeferred = entries.filter((e) => e.defer === 'always')
  const autoCandidates = entries.filter((e) => e.defer === 'auto')

  const autoCost = estimateAutoTokens(autoCandidates)
  const autoOverflowsThreshold = autoCost > threshold
  const autoPoolBigEnough = autoCandidates.length >= MIN_AUTO_DEFER_COUNT
  const autoSavingsBeatOverhead = autoCost > META_TOOLS_OVERHEAD_TOKENS
  const autoDeferred = autoOverflowsThreshold && autoPoolBigEnough && autoSavingsBeatOverhead ? autoCandidates : []

  const deferredNames = new Set([...alwaysDeferred, ...autoDeferred].map((e) => e.name))

  return { deferredNames, threshold }
}

//TODO： token api
function estimateAutoTokens(entries: readonly ToolEntry[]): number {
  let chars = 0
  for (const entry of entries) {
    chars += entry.name.length
    // The LLM-visible cost is `tool.description` + `tool.inputSchema` (what
    // AI SDK serialises into the tools array). `entry.description` is only
    // shown by `tool_search`, never inline.
    const tool = entry.tool as { description?: string; inputSchema?: unknown }
    if (typeof tool.description === 'string') chars += tool.description.length
    if (tool.inputSchema) chars += JSON.stringify(tool.inputSchema).length
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}
