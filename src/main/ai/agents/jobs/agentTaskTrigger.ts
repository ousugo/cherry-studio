import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

/**
 * Pure helper that converts an `agent_task` row's schedule fields to a
 * JobManager Trigger. Lives in its own module so consumers
 * (`AgentTaskWorkflowService`) can import it without dragging in
 * `agentTaskHandler`'s heavy stream / facade imports — which sit on the
 * other side of the `claw` MCP load chain that the Claude driver loads
 * eagerly.
 */
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
