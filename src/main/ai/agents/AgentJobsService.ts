import { agentTaskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

import { agentTaskHandler, agentTaskToJobTrigger } from './jobs/agentTaskHandler'

const logger = loggerService.withContext('AgentJobsService')

/**
 * Lifecycle owner for agent-related JobManager wiring: registers the
 * `agent.task` handler, exposes the Run-Now IPC, and reconciles existing
 * `agent_task` rows into JobManager schedules on startup.
 */
@Injectable('AgentJobsService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager', 'AiStreamManager', 'AgentSessionRuntimeService'])
export class AgentJobsService extends BaseService {
  protected async onInit(): Promise<void> {
    application.get('JobManager').registerHandler('agent.task', agentTaskHandler)

    this.ipcHandle(IpcChannel.Agent_RunTask, async (_event, agentId: string, taskId: string) => {
      if (!agentId || !taskId) {
        throw new Error('Agent_RunTask requires both agentId and taskId')
      }
      const handle = await application.get('JobManager').enqueue('agent.task', { agentId, taskId })
      return { jobId: handle.id }
    })
  }

  protected async onReady(): Promise<void> {
    await this.backfillSchedules()
  }

  /**
   * One-time reconciliation between `agent_task` rows and JobManager
   * schedules. Idempotent: re-registers / updates existing schedules in
   * place, skips inactive tasks, removes schedules whose triggers no
   * longer parse.
   */
  private async backfillSchedules(): Promise<void> {
    const jobManager = application.get('JobManager')
    const tasks = await agentTaskService.listAllActiveTasksIncludingHeartbeat()
    for (const task of tasks) {
      const trigger = agentTaskToJobTrigger(task)
      if (!trigger) continue
      try {
        const existing = await jobManager.getJobSchedule('agent.task', task.id)
        if (existing) {
          await jobManager.updateJobSchedule(existing.id, {
            trigger,
            jobInputTemplate: { agentId: task.agentId, taskId: task.id },
            enabled: true
          })
        } else {
          await jobManager.registerJobSchedule({
            type: 'agent.task',
            name: task.id,
            trigger,
            jobInputTemplate: { agentId: task.agentId, taskId: task.id },
            catchUpPolicy: { kind: 'skip-missed' },
            enabled: true
          })
        }
      } catch (err) {
        logger.warn('Failed to backfill agent.task schedule', {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }
}
