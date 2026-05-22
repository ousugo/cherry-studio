import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { sessionService } from '@data/services/SessionService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { JobHandler } from '@main/core/job/types'
import { readHeartbeat } from '@main/services/agents/services/cherryclaw/heartbeat'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

import { ChannelAdapterListener, type StreamListener } from '../../stream-manager'
import { startAgentSessionRun } from '../api/startAgentSessionRun'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'agent.task': { agentId: string; taskId: string }
  }
}

const logger = loggerService.withContext('AgentTaskHandler')

export const AGENT_TASK_JOB_TYPE = 'agent.task' as const

/** Convert an `agent_task` row's schedule fields to a JobManager Trigger. Returns `null` if unparseable. */
export function agentTaskToJobTrigger(task: ScheduledTaskEntity): Trigger | null {
  switch (task.scheduleType) {
    case 'cron':
      return { kind: 'cron', expr: task.scheduleValue }
    case 'interval': {
      const minutes = parseInt(task.scheduleValue, 10)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      return { kind: 'interval', ms: minutes * 60_000 }
    }
    case 'once': {
      const at = parseInt(task.scheduleValue, 10)
      if (!Number.isFinite(at)) return null
      return { kind: 'once', at }
    }
  }
}

export const agentTaskHandler: JobHandler<{ agentId: string; taskId: string }> = {
  recovery: 'abandon',
  defaultQueue: () => 'agent.task',
  defaultConcurrency: 2,

  async execute(ctx) {
    const { agentId, taskId } = ctx.input
    const startTime = Date.now()

    const task = await agentTaskService.getTask(agentId, taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    const logId = await agentTaskService.logTaskRun({
      taskId: task.id,
      sessionId: null,
      runAt: Date.now(),
      durationMs: 0,
      status: 'running',
      result: null,
      error: null
    })

    let result: string | null = null
    let error: string | null = null
    let sessionId: string | undefined
    let subscribedChannels: { id: string; sessionId?: string | null }[] = []

    try {
      const agent = await agentService.getAgent(task.agentId)
      if (!agent) throw new Error(`Agent not found: ${task.agentId}`)
      if (!agent.model) throw new Error(`Agent ${task.agentId} has no model configured`)

      const config = agent.configuration ?? {}
      subscribedChannels = await agentChannelService.getSubscribedChannels(task.id)

      const lastSessionId = await agentTaskService.getLastRunSessionId(task.id)
      let session = lastSessionId ? await sessionService.getById(lastSessionId).catch(() => null) : null
      if (!session) {
        session = await sessionService.createSession({ agentId: task.agentId, name: task.name || 'Scheduled run' })
      }
      sessionId = session.id

      let fullPrompt = task.prompt
      if (task.name === 'heartbeat') {
        const workspacePath = session.workspace?.path
        if (config.heartbeat_enabled === false || !workspacePath) {
          result = 'Skipped (disabled)'
          return
        }
        const heartbeatContent = await readHeartbeat(workspacePath)
        if (!heartbeatContent) {
          result = 'Skipped (no file)'
          return
        }
        fullPrompt = [
          '[Heartbeat]',
          'This is a periodic heartbeat. The instructions below are from your heartbeat.md file.',
          'Process each item, take action where possible, and use the notify tool to alert the user of important results.',
          '',
          '---',
          heartbeatContent
        ].join('\n')
      }

      const channelListeners: StreamListener[] = subscribedChannels.flatMap((ch) => {
        const adapter = application.get('ChannelManager').getAdapter(ch.id)
        if (!adapter) return []
        return adapter.notifyChatIds.map((chatId) => new ChannelAdapterListener(adapter, chatId))
      })

      let resolveExecution!: (text: string) => void
      let rejectExecution!: (err: unknown) => void
      const executionDone = new Promise<string>((resolve, reject) => {
        resolveExecution = resolve
        rejectExecution = reject
      })
      let accumulatedText = ''
      const sentinel: StreamListener = {
        id: `agent-task-job:${task.id}`,
        onChunk(chunk) {
          const c = chunk as { type: string; text?: string }
          if (c.type === 'text-delta' && c.text) accumulatedText += c.text
        },
        onDone() {
          resolveExecution(accumulatedText.trim())
        },
        onPaused() {
          if (ctx.signal.aborted) {
            const reason = ctx.signal.reason
            rejectExecution(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
            return
          }
          resolveExecution(accumulatedText.trim())
        },
        onError(streamResult) {
          rejectExecution(new Error(streamResult.error.message ?? 'Execution failed'))
        },
        isAlive: () => !ctx.signal.aborted
      }

      const timeoutMs = task.timeoutMinutes && task.timeoutMinutes > 0 ? task.timeoutMinutes * 60_000 : undefined
      const timeoutTimer = timeoutMs
        ? setTimeout(() => {
            rejectExecution(new Error(`Task timed out after ${task.timeoutMinutes} minutes`))
          }, timeoutMs)
        : null

      try {
        await startAgentSessionRun({
          sessionId: session.id,
          userParts: [{ type: 'text', text: fullPrompt }],
          listeners: [sentinel, ...channelListeners]
        })

        const responseText = await executionDone
        result = responseText.slice(0, 200) || 'Completed'
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer)
      }

      logger.info('Task completed', { taskId: task.id, durationMs: Date.now() - startTime })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      logger.error('Task failed', { taskId: task.id, error })
    } finally {
      const durationMs = Date.now() - startTime
      await agentTaskService.updateTaskRunLog(logId, {
        sessionId: sessionId ?? null,
        durationMs,
        status: error ? 'error' : 'success',
        result,
        error
      })

      const nextRun = agentTaskService.computeNextRun(task)
      const resultSummary = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed'
      await agentTaskService.updateTaskAfterRun(task.id, nextRun, resultSummary)

      if (error) {
        await notifyTaskError(task, durationMs, error, subscribedChannels)
      }
    }
  }
}

async function notifyTaskError(
  task: ScheduledTaskEntity,
  durationMs: number,
  error: string,
  subscribedChannels: { id: string; sessionId?: string | null }[]
): Promise<void> {
  if (subscribedChannels.length === 0) return
  const durationSec = Math.round(durationMs / 1000)
  const text = `[Task failed] ${task.name}\nDuration: ${durationSec}s\nError: ${error}`

  for (const ch of subscribedChannels) {
    const adapter = application.get('ChannelManager').getAdapter(ch.id)
    if (!adapter) continue
    for (const chatId of adapter.notifyChatIds) {
      adapter.sendMessage(chatId, text).catch((err) => {
        logger.warn('Failed to send task error notification', {
          taskId: task.id,
          channelId: ch.id,
          chatId,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    }
  }
}
