import { loggerService } from '@logger'
import { agentTaskToJobTrigger } from '@main/ai/agents/jobs/agentTaskTrigger'
import { application } from '@main/core/application'
import type { CreateTaskDto, UpdateTaskDto } from '@shared/data/api/schemas/agents'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

import { agentTaskService } from './AgentTaskService'

const logger = loggerService.withContext('AgentTaskWorkflowService')

export class AgentTaskWorkflowService {
  async createTask(agentId: string, data: CreateTaskDto) {
    const task = await agentTaskService.createTask(agentId, data)
    await this.syncSchedule(task).catch((err) => {
      logger.warn('Failed to register agent.task schedule after create', {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err)
      })
    })
    return task
  }

  async updateTask(agentId: string, taskId: string, updates: UpdateTaskDto) {
    const task = await agentTaskService.updateTask(agentId, taskId, updates)
    if (task) {
      await this.syncSchedule(task).catch((err) => {
        logger.warn('Failed to sync agent.task schedule after update', {
          taskId,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    }
    return task
  }

  async deleteTask(agentId: string, taskId: string) {
    const deleted = await agentTaskService.deleteTask(agentId, taskId)
    if (deleted) {
      await application
        .get('JobManager')
        .unregisterJobSchedule('agent.task', taskId)
        .catch((err) =>
          logger.warn('Failed to unregister agent.task schedule after delete', {
            taskId,
            error: err instanceof Error ? err.message : String(err)
          })
        )
    }
    return deleted
  }

  /**
   * Upsert the JobManager schedule that mirrors this `agent_task` row.
   * Inactive tasks or unparseable triggers result in the schedule being
   * removed (or never created).
   */
  private async syncSchedule(task: ScheduledTaskEntity): Promise<void> {
    const jobManager = application.get('JobManager')
    const trigger = agentTaskToJobTrigger(task)
    const enabled = task.status === 'active' && trigger !== null

    const existing = await jobManager.getJobSchedule('agent.task', task.id)
    if (existing) {
      if (!trigger) {
        await jobManager.unregisterJobScheduleById(existing.id)
        return
      }
      await jobManager.updateJobSchedule(existing.id, {
        trigger,
        jobInputTemplate: { agentId: task.agentId, taskId: task.id },
        enabled
      })
      return
    }

    if (trigger && enabled) {
      await jobManager.registerJobSchedule({
        type: 'agent.task',
        name: task.id,
        trigger,
        jobInputTemplate: { agentId: task.agentId, taskId: task.id },
        catchUpPolicy: { kind: 'skip-missed' },
        enabled: true
      })
    }
  }
}

export const agentTaskWorkflowService = new AgentTaskWorkflowService()
