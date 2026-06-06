/**
 * Web fetch tool — agentic.
 *
 * The model supplies known page URLs (often from a prior `web__search`) and
 * gets back their readable content. Provider ids are resolved inside
 * WebSearchService from the user's configured default provider.
 */

import { loggerService } from '@logger'
import { application } from '@main/core/application'
import {
  WEB_FETCH_TOOL_NAME,
  webFetchInputSchema,
  type WebFetchOutput,
  webFetchOutputSchema
} from '@shared/ai/builtinTools'
import type { WebSearchResponse } from '@shared/data/types/webSearch'
import { type InferToolInput, type InferToolOutput, tool } from 'ai'
import * as z from 'zod'

import { getToolCallContext } from '../context'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('WebFetchTool')

/**
 * A failed lookup must be distinguishable from "ran fine, found nothing": both
 * would otherwise return `[]`. `execute` returns the results array on success
 * (validated by `webFetchOutputSchema`) or `{ error }` on failure, and
 * `toModelOutput` renders a retry note for the error branch. We never throw:
 * throwing would abort the surrounding agentic loop.
 */
const webFetchErrorSchema = z.object({ error: z.string() })
const webFetchResultSchema = z.union([webFetchOutputSchema, webFetchErrorSchema])

type WebFetchResult = WebFetchOutput | z.infer<typeof webFetchErrorSchema>

const WEB_LOOKUP_ERROR_NOTE = 'Web search failed (network/provider error); retry or inform the user.'

function isWebLookupError(output: unknown): output is z.infer<typeof webFetchErrorSchema> {
  return webFetchErrorSchema.safeParse(output).success
}

function mapWebFetchOutput(response: WebSearchResponse): WebFetchOutput {
  return response.results.map((result, index) => ({
    id: index + 1,
    title: result.title,
    url: result.url,
    content: result.content
  }))
}

const webFetchTool = tool({
  description: `Fetch the readable content from one or more known web page URLs.

Use this when:
- You already have specific URLs from the user, prior context, or web__search
- You need page content from an article, documentation page, or reference URL
- Search snippets are not enough and you need the source page text

Don't use this when you only have a topic or question; call web__search first.

Cite sources by [id] in your final answer.`,
  inputSchema: webFetchInputSchema,
  outputSchema: webFetchResultSchema,
  strict: true,
  execute: async ({ urls }, options): Promise<WebFetchResult> => {
    const { request } = getToolCallContext(options)

    try {
      const webSearchService = application.get('WebSearchService')
      const response = await webSearchService.fetchUrls(
        {
          urls
        },
        { signal: request.abortSignal }
      )
      return mapWebFetchOutput(response)
    } catch (error) {
      logger.error('webSearchService.fetchUrls failed', error as Error, {
        urls
      })
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
  toModelOutput: ({ output }) => {
    if (isWebLookupError(output)) {
      return { type: 'text' as const, value: WEB_LOOKUP_ERROR_NOTE }
    }
    return { type: 'json' as const, value: output }
  }
})

export function createWebFetchToolEntry(): ToolEntry {
  return {
    name: WEB_FETCH_TOOL_NAME,
    namespace: 'web',
    description: 'Fetch readable content from known web page URLs',
    defer: 'auto',
    tool: webFetchTool,
    applies: (scope) => Boolean(scope.assistant?.settings?.enableWebSearch)
  }
}

export type WebFetchToolInput = InferToolInput<typeof webFetchTool>
export type WebFetchToolOutput = InferToolOutput<typeof webFetchTool>
