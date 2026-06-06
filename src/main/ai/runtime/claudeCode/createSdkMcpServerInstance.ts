import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  type Prompt as SdkPrompt,
  type Resource as SdkResource,
  type Tool as SdkTool
} from '@modelcontextprotocol/sdk/types.js'
import type { McpPrompt, McpResource, McpTool } from '@types'

const logger = loggerService.withContext('SdkMcpBridge')

function toSdkTool(tool: McpTool): SdkTool {
  const sdkTool = { ...tool } as SdkTool & Record<'id' | 'serverId' | 'serverName' | 'type', unknown>
  Reflect.deleteProperty(sdkTool, 'id')
  Reflect.deleteProperty(sdkTool, 'serverId')
  Reflect.deleteProperty(sdkTool, 'serverName')
  Reflect.deleteProperty(sdkTool, 'type')
  return sdkTool
}

function toSdkResource(resource: McpResource): SdkResource {
  const sdkResource = { ...resource } as SdkResource & Record<'serverId' | 'serverName', unknown>
  Reflect.deleteProperty(sdkResource, 'serverId')
  Reflect.deleteProperty(sdkResource, 'serverName')
  return sdkResource
}

function toSdkPrompt(prompt: McpPrompt): SdkPrompt {
  const sdkPrompt = { ...prompt } as SdkPrompt & Record<'id' | 'serverId' | 'serverName', unknown>
  Reflect.deleteProperty(sdkPrompt, 'id')
  Reflect.deleteProperty(sdkPrompt, 'serverId')
  Reflect.deleteProperty(sdkPrompt, 'serverName')
  return sdkPrompt
}

/**
 * Creates an `McpServer` instance that acts as an in-process bridge,
 * proxying tool/resource/prompt list and call requests to an existing MCP
 * server managed by `McpRuntimeService`.
 *
 * The returned instance is designed for use with the Claude Agent SDK's
 * in-memory (`type: 'sdk'`) transport, keeping all communication
 * within the Electron main process.
 */
export async function createSdkMcpServerInstance(mcpId: string): Promise<McpServer> {
  const serverConfig = await mcpServerService.findByIdOrName(mcpId)
  if (!serverConfig) {
    throw new Error(`MCP server not found: ${mcpId}`)
  }

  const sdkServer = new McpServer(
    { name: serverConfig.name, version: '0.1.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  )

  // Use the low-level Server to set raw request handlers because this bridge
  // proxies requests to the downstream MCP server whose tool schemas are not
  // known at construction time. The high-level McpServer.tool() API requires
  // Zod schemas to be declared upfront, which is not feasible for a proxy.
  const rawServer = sdkServer.server

  rawServer.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      logger.debug('SDK bridge: listing tools', { mcpId })
      const tools = await application.get('McpCatalogService').listTools(serverConfig.id, { includeDisabled: false })
      return {
        tools: tools.map(toSdkTool)
      }
    } catch (error) {
      logger.error('SDK bridge: failed to list tools', { mcpId, error })
      throw error
    }
  })

  rawServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      logger.debug('SDK bridge: calling tool', { mcpId, tool: request.params.name })
      const result = await application.get('McpRuntimeService').callTool({
        serverId: serverConfig.id,
        name: request.params.name,
        args: request.params.arguments
      })
      return result as CallToolResult
    } catch (error) {
      logger.error('SDK bridge: failed to call tool', { mcpId, tool: request.params.name, error })
      throw error
    }
  })

  rawServer.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      logger.debug('SDK bridge: listing resources', { mcpId })
      const resources = await application.get('McpCatalogService').listResources(serverConfig.id)
      return {
        resources: resources.map(toSdkResource)
      }
    } catch (error) {
      logger.error('SDK bridge: failed to list resources', { mcpId, error })
      throw error
    }
  })

  rawServer.setRequestHandler(ListPromptsRequestSchema, async () => {
    try {
      logger.debug('SDK bridge: listing prompts', { mcpId })
      const prompts = await application.get('McpCatalogService').listPrompts(serverConfig.id)
      return {
        prompts: prompts.map(toSdkPrompt)
      }
    } catch (error) {
      logger.error('SDK bridge: failed to list prompts', { mcpId, error })
      throw error
    }
  })

  logger.info(`Created SDK MCP bridge for "${serverConfig.name}"`)
  return sdkServer
}
