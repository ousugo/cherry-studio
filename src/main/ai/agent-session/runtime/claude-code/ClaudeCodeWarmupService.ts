import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { AiAgentSessionWarmCloseRequest, AiAgentSessionWarmRequest } from '@shared/ai/transport'
import { IpcChannel } from '@shared/IpcChannel'

import { buildClaudeCodeWarmQueryRequestForAgentSession } from './agentSessionWarmup'

const logger = loggerService.withContext('ClaudeCodeWarmupService')

@Injectable('ClaudeCodeWarmupService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ClaudeCodeWarmQueryManager'])
export class ClaudeCodeWarmupService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Ai_AgentSession_Prewarm, async (_, req: AiAgentSessionWarmRequest) => {
      await this.prewarmAgentSession(req.sessionId)
    })

    this.ipcHandle(IpcChannel.Ai_AgentSession_CloseWarm, (_, req: AiAgentSessionWarmCloseRequest) => {
      this.closeAgentSessionWarm(req.sessionId)
    })
  }

  async prewarmAgentSession(sessionId: string): Promise<void> {
    try {
      const warmRequest = await buildClaudeCodeWarmQueryRequestForAgentSession(sessionId)
      if (!warmRequest) return
      application.get('ClaudeCodeWarmQueryManager').prewarm(warmRequest)
    } catch (error) {
      logger.warn('Failed to prewarm agent session', { sessionId, error })
    }
  }

  closeAgentSessionWarm(sessionId: string): void {
    try {
      application.get('ClaudeCodeWarmQueryManager').close(sessionId)
    } catch (error) {
      logger.debug('Failed to close agent session warm query', { sessionId, error })
    }
  }
}
