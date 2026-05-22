import { loggerService } from '@logger'
import { agentRuntimeDriverRegistry } from '@main/ai/agent-session/runtime'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { extractRtkBinaries } from '../utils/rtk'
import { channelManager } from './agents/services/channels'

const logger = loggerService.withContext('AgentBootstrapService')
const RunTaskArgsSchema = z.strictObject({
  agentId: z.string().min(1),
  taskId: z.string().min(1)
})
const AgentTypeSchema = z.enum(['claude-code'])
const ListToolsArgsSchema = z.strictObject({
  type: AgentTypeSchema.default('claude-code'),
  mcps: z.array(z.string()).default([])
})

export function validateRunTaskArgs(agentId: string, taskId: string) {
  return RunTaskArgsSchema.parse({ agentId, taskId })
}

export function validateListToolsArgs(args: unknown) {
  return ListToolsArgsSchema.parse(args ?? {})
}

/**
 * Lifecycle-managed service that orchestrates agent subsystem initialization.
 *
 * Wraps the non-lifecycle agent singletons (channelManager) so their
 * startup/shutdown is managed by the application lifecycle. The `agent.task`
 * scheduler / Run-Now IPC now lives in `AgentJobsService`.
 */
@Injectable('AgentBootstrapService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiServerService'])
export class AgentBootstrapService extends BaseService {
  protected async onReady(): Promise<void> {
    await this.extractRtkBinaries()

    this.ipcHandle(IpcChannel.Agent_ListTools, async (_, args: unknown) => {
      const parsed = validateListToolsArgs(args)
      const driver = agentRuntimeDriverRegistry.get(parsed.type)
      if (!driver) {
        throw new Error(`Unsupported agent runtime type: ${parsed.type}`)
      }
      return driver.listAvailableTools(parsed.mcps)
    })

    await channelManager.start()
    logger.info('Channel manager started')
  }

  protected async onStop(): Promise<void> {
    // Cleanup belongs to onStop (not onDestroy) so the service is restartable:
    // a restart after `application.stop('AgentBootstrapService')` would
    // otherwise leak channel adapter sets.
    await channelManager.stop()
    logger.info('Channel manager stopped')
  }

  private async extractRtkBinaries(): Promise<void> {
    try {
      await extractRtkBinaries()
    } catch (error) {
      logger.warn('Failed to extract rtk binaries (non-fatal)', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
