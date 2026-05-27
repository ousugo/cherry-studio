import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetBuiltinSlashCommands } = vi.hoisted(() => ({
  mockGetBuiltinSlashCommands: vi.fn()
}))

vi.mock('@shared/ai/agentSlashCommands', () => ({
  getBuiltinSlashCommands: (...args: unknown[]) => mockGetBuiltinSlashCommands(...args)
}))

import slashCommandsTool from '../slashCommandsTool'

describe('slashCommandsTool', () => {
  beforeEach(() => {
    mockGetBuiltinSlashCommands.mockReset()
  })

  it('keeps slash commands out of the plus popover and groups them in slash suggestions', () => {
    mockGetBuiltinSlashCommands.mockReturnValue([{ command: '/clear', description: 'Clear context' }])

    const launchers = slashCommandsTool.composer?.menuItems?.createItems({
      actions: { onTextChange: vi.fn() },
      session: { agentType: 'claude-code' },
      t: (key: string) => key
    } as any)

    expect(launchers).toEqual([
      expect.objectContaining({
        id: 'slash-commands',
        label: 'chat.input.slash_commands.title',
        sources: ['root-panel'],
        submenu: [
          expect.objectContaining({
            id: 'slash-command:/clear',
            label: '/clear',
            sources: ['root-panel']
          })
        ]
      })
    ])
    expect(launchers?.some((launcher) => launcher.sources?.includes('popover'))).toBe(false)
  })
})
