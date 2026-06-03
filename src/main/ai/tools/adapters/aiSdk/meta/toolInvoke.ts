/**
 * `tool_invoke` meta-tool — dispatches a tool by name through the registry.
 * The LLM uses this together with `tool_search`: search to discover, invoke
 * to call.
 *
 * Forwards the AI SDK execution options (messages, abortSignal,
 * experimental_context) onto the inner tool's `execute` so the per-request
 * RequestContext flows through. The inner `toolCallId` is suffixed with the
 * target name so telemetry can rebuild the call tree.
 */

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { isApprovalGated } from '../isApprovalGated'
import type { ToolRegistry } from '../registry'

export const TOOL_INVOKE_TOOL_NAME = 'tool_invoke'

export function createToolInvokeTool(registry: ToolRegistry): Tool {
  return tool({
    description:
      'Call a tool discovered via `tool_search` by name. Pass arguments under `params` matching the tool input schema.',
    inputSchema: z.object({
      name: z.string().describe('Tool name as returned by tool_search'),
      params: z.record(z.string(), z.unknown()).optional().describe('Tool input arguments')
    }),
    execute: async ({ name, params }, options) => {
      const entry = registry.getByName(name)
      if (!entry) throw new Error(`Tool not found: ${name}`)
      if (typeof entry.tool.execute !== 'function') {
        throw new Error(`Tool ${name} has no execute handler`)
      }
      // Enforce the approval gate at the registry execution boundary. The SDK's native
      // `needsApproval` check only fires for tools it dispatches itself; a tool reached through
      // this meta-tool would otherwise bypass it. Approval-gated tools are kept inline (see
      // `applyDeferExposition`), so refusing here just steers the model to call them directly.
      if (
        await isApprovalGated(entry.tool, {
          input: params ?? {},
          toolCallId: options.toolCallId,
          messages: options.messages,
          experimental_context: options.experimental_context
        })
      ) {
        throw new Error(`Tool "${name}" requires user approval; call it directly instead of via tool_invoke.`)
      }
      return entry.tool.execute(params ?? {}, {
        ...options,
        toolCallId: `${options.toolCallId}::${name}`
      })
    }
  })
}
