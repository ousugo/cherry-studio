import type { AgentRuntimeDriver } from './types'

class AgentRuntimeDriverRegistry {
  private readonly drivers = new Map<string, AgentRuntimeDriver>()

  register(driver: AgentRuntimeDriver): void {
    this.drivers.set(driver.type, driver)
  }

  get(type: string): AgentRuntimeDriver | undefined {
    return this.drivers.get(type)
  }

  clearForTest(): void {
    this.drivers.clear()
  }
}

export const agentRuntimeDriverRegistry = new AgentRuntimeDriverRegistry()
