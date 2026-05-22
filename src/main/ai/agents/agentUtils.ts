import { application } from '@application'
import { loggerService } from '@logger'
import { getMcpApiService } from '@main/apiServer/services/mcp'
import type { AgentTool as Tool } from '@shared/data/api/schemas/agents'
import type { AgentType } from '@shared/data/types/agent'
import { buildFunctionCallToolName } from '@shared/mcp'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

import { builtinTools } from '../agent-session/runtime/claude-code/builtinTools'

const logger = loggerService.withContext('agentUtils')

/**
 * Walk a list of absolute workspace paths: skip empty/duplicate entries,
 * auto-create missing parent directories, and return the deduplicated result.
 * Rejects relative paths to keep Claude Code's `cwd` hermetic.
 */
function ensurePathsExist(paths?: string[]): string[] {
  if (!paths?.length) {
    return []
  }

  const sanitizedPaths: string[] = []
  const seenPaths = new Set<string>()

  for (const rawPath of paths) {
    if (!rawPath) {
      continue
    }

    if (!path.isAbsolute(rawPath)) {
      throw new Error(`Accessible path must be absolute: ${rawPath}`)
    }

    const resolvedPath = path.normalize(rawPath)

    let stats: fs.Stats | null = null
    try {
      if (fs.existsSync(resolvedPath)) {
        stats = fs.statSync(resolvedPath)
      }
    } catch (error) {
      logger.warn('Failed to inspect accessible path', {
        path: rawPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    const looksLikeFile =
      (stats && stats.isFile()) || (!stats && path.extname(resolvedPath) !== '' && !resolvedPath.endsWith(path.sep))

    const directoryToEnsure = looksLikeFile ? path.dirname(resolvedPath) : resolvedPath

    if (!fs.existsSync(directoryToEnsure)) {
      try {
        fs.mkdirSync(directoryToEnsure, { recursive: true })
      } catch (error) {
        logger.error('Failed to create accessible path directory', {
          path: directoryToEnsure,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }

    if (!seenPaths.has(resolvedPath)) {
      seenPaths.add(resolvedPath)
      sanitizedPaths.push(resolvedPath)
    }
  }

  return sanitizedPaths
}

export function resolveAccessiblePaths(paths?: string[]): string[] {
  if (!paths || paths.length === 0) {
    // Keep workspace layout independent from agent id formats (`agent_*` today, UUID after migration).
    paths = [path.join(application.getPath('feature.agents.workspaces'), uuidv4())]
  }
  return ensurePathsExist(paths)
}

export async function listMcpTools(agentType: AgentType, ids?: string[]): Promise<Tool[]> {
  const tools: Tool[] = []
  if (agentType === 'claude-code') {
    tools.push(...builtinTools)
  }
  if (!ids?.length) {
    return tools
  }
  for (const id of ids) {
    try {
      const server = await getMcpApiService().getServerInfo(id)
      if (!server) {
        continue
      }
      for (const tool of server.tools) {
        tools.push({
          id: buildFunctionCallToolName(server.name, tool.name),
          name: tool.name,
          type: 'mcp',
          description: tool.description || '',
          requirePermissions: true
        })
      }
    } catch (error) {
      logger.warn('Failed to list MCP tools', { id, error: error as Error })
    }
  }
  return tools
}
