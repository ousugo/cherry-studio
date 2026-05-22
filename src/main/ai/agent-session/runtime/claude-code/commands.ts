import { getBuiltinSlashCommands } from '@shared/agents/agentSlashCommands'
import type { SlashCommand } from '@shared/data/types/agent'

export const builtinSlashCommands: SlashCommand[] = getBuiltinSlashCommands('claude-code')
