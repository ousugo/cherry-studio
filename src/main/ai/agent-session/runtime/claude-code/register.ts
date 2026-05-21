import { agentRuntimeDriverRegistry } from '../registry'
import { ClaudeCodeRuntimeDriver } from './ClaudeCodeRuntimeDriver'

agentRuntimeDriverRegistry.register(new ClaudeCodeRuntimeDriver())
