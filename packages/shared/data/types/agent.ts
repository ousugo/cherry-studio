/**
 * Agent domain entity types
 *
 * Types are derived from Zod entity schemas in `../api/schemas/*`.
 * This file re-exports inferred types for backward-compatible consumption
 * across main and renderer.
 */

export type {
  AgentBase,
  AgentConfiguration,
  AgentDetail,
  AgentEntity,
  AgentTool,
  InstalledSkill,
  ScheduledTaskEntity,
  SlashCommand,
  TaskRunLogEntity
} from '../api/schemas/agents'
export type { AgentSessionMessageEntity } from '../api/schemas/sessions'

// ============================================================================
// Core agent types (plain aliases for non-Zod consumers)
// ============================================================================

export type AgentType = 'claude-code'

export type TaskScheduleType = 'cron' | 'interval' | 'once'

export type TaskStatus = 'active' | 'paused' | 'completed'

// ============================================================================
// Task DTOs (renderer hooks + main test seeding both consume these)
// ============================================================================

export interface CreateTaskRequest {
  name: string
  prompt: string
  scheduleType: TaskScheduleType
  scheduleValue: string
  timeoutMinutes?: number | null
  channelIds?: string[]
}

export interface UpdateTaskRequest {
  name?: string
  prompt?: string
  agentId?: string
  scheduleType?: TaskScheduleType
  scheduleValue?: string
  timeoutMinutes?: number | null
  channelIds?: string[]
  status?: TaskStatus
}
