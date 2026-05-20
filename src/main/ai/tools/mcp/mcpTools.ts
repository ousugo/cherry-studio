import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { mcpServerService } from '@main/data/services/McpServerService'
import { shouldAutoApprove } from '@main/services/toolApproval/autoApprovePolicy'
import { toCamelCase } from '@shared/mcp'
import type { MCPCallToolResponse, MCPServer, MCPTool } from '@types'
import { jsonSchema, type JSONSchema7, type Tool } from 'ai'

async function resolveServerById(serverId: string): Promise<MCPServer | undefined> {
  const { items } = await mcpServerService.list({ isActive: true })
  return items.find((s) => s.id === serverId)
}

import { registry, type ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { mcpResultToTextSummary } from './utils'

const logger = loggerService.withContext('mcpTools')

/** Build the AI SDK Tool wrapper around a single MCPTool. */
function createMcpTool(mcpTool: MCPTool, disabledAutoApproveTools?: readonly string[]): Tool {
  return {
    type: 'function',
    description: mcpTool.description || mcpTool.name,
    inputSchema: jsonSchema(mcpTool.inputSchema as JSONSchema7),
    needsApproval: async () =>
      !shouldAutoApprove({
        toolKind: 'mcp',
        toolName: mcpTool.name,
        serverDisabledAutoApprove: disabledAutoApproveTools
      }),
    execute: async (args: Record<string, unknown>, { toolCallId }) => {
      const server = await resolveServerById(mcpTool.serverId)
      if (!server) {
        throw new Error(`MCP server ${mcpTool.serverId} is not active or no longer registered`)
      }
      const mcpService = application.get('McpService')
      const result: MCPCallToolResponse = await mcpService.callTool({
        server,
        name: mcpTool.name,
        args,
        callId: toolCallId
      })

      if (result.isError) {
        throw new Error(mcpResultToTextSummary(result) || 'MCP tool call failed')
      }

      // Return the full MCPCallToolResponse so the renderer's ToolUIPart has
      // access to the original content array (images, audio, resources). The
      // model-facing string view is produced by `toModelOutput` below so
      // multimodal parts collapse to placeholders instead of being silently
      // dropped.
      return {
        ...result,
        metadata: {
          serverName: mcpTool.serverName,
          serverId: mcpTool.serverId,
          type: 'mcp' as const
        }
      }
    },
    toModelOutput({ output }) {
      const result = output as MCPCallToolResponse
      return { type: 'text' as const, value: mcpResultToTextSummary(result) }
    }
  }
}

function toEntry(mcpTool: MCPTool, server: MCPServer): ToolEntry {
  return {
    name: mcpTool.id,
    namespace: `mcp:${server.name}`,
    description: mcpTool.description || mcpTool.name,
    defer: 'auto',
    tool: createMcpTool(mcpTool, server.disabledAutoApproveTools),
    applies: (scope) => scope.mcpToolIds.has(mcpTool.id)
  }
}

/**
 * Subset of active servers whose tool ids prefix-match any id in
 * `selectedToolIds`. Prefix derives from `buildFunctionCallToolName` —
 * `mcp__<camelCase(serverName)>__<rest>` — so the same camel-casing must
 * be applied here for the match to hold.
 */
function filterServersByToolIds(
  servers: readonly MCPServer[],
  selectedToolIds: ReadonlySet<string>
): readonly MCPServer[] {
  if (!selectedToolIds.size) return []
  return servers.filter((server) => {
    const prefix = `mcp__${toCamelCase(server.name)}__`
    for (const id of selectedToolIds) {
      if (id.startsWith(prefix)) return true
    }
    return false
  })
}

export interface SyncMcpToolsToRegistryOptions {
  /**
   * Restrict the expensive per-server `listTools` round-trip to servers
   * whose tool ids appear in this set. Servers absent from the set keep
   * their existing registry entries untouched — neither relisted nor
   * evicted. Stale-server cleanup (dropping entries from servers that are
   * no longer active at all) still runs globally.
   *
   * Omit to sync every active server — the legacy "full reconcile"
   * behaviour. Suitable for one-shot bootstrap or admin actions where the
   * caller has no selection context.
   */
  readonly selectedToolIds?: ReadonlySet<string>
}

/**
 * Reconcile the registry's MCP entries with the live server snapshot. Adds
 * entries for tools currently listable, replaces existing ones (so schema
 * changes take effect immediately), and drops entries whose tools are no
 * longer in the snapshot — covering both server uninstall and per-server
 * `tools/list_changed` notifications without an explicit event subscription.
 *
 * Per-request callers should pass `selectedToolIds` so we don't pay the
 * `listTools` round-trip on N-1 servers when only one server's tools were
 * actually selected. See {@link SyncMcpToolsToRegistryOptions}.
 *
 * Tests pass a fresh registry; production calls default to the module
 * singleton.
 */
export async function syncMcpToolsToRegistry(
  reg: ToolRegistry = registry,
  opts: SyncMcpToolsToRegistryOptions = {}
): Promise<void> {
  const mcpService = application.get('McpService')
  const { items: activeServers } = await mcpServerService.list({ isActive: true })

  const targetServers = opts.selectedToolIds
    ? filterServersByToolIds(activeServers, opts.selectedToolIds)
    : activeServers
  const targetNamespaces = new Set(targetServers.map((s) => `mcp:${s.name}`))
  const activeNamespaces = new Set(activeServers.map((s) => `mcp:${s.name}`))

  const freshNames = new Set<string>()
  for (const server of targetServers) {
    try {
      const allTools = await mcpService.listTools(server)
      for (const mcpTool of allTools) {
        reg.register(toEntry(mcpTool, server))
        freshNames.add(mcpTool.id)
      }
    } catch (error) {
      logger.error('Failed to list MCP tools for server', {
        serverId: server.id,
        serverName: server.name,
        error
      })
    }
  }

  for (const entry of reg.getAll()) {
    if (!entry.namespace.startsWith('mcp:')) continue
    const serverDeactivated = !activeNamespaces.has(entry.namespace)
    const inSyncScope = targetNamespaces.has(entry.namespace)
    const missing = !freshNames.has(entry.name)
    if (serverDeactivated || (inSyncScope && missing)) {
      reg.deregister(entry.name)
    }
  }
}
