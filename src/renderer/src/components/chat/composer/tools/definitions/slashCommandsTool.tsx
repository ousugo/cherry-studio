import type { ComposerToolLauncher } from '@renderer/components/chat/composer/toolLauncher'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { type QuickPanelInputAdapter, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { getBuiltinSlashCommands } from '@shared/data/types/agentSlashCommands'
import { Terminal } from 'lucide-react'

/**
 * Helper function to insert slash command through the composer adapter.
 * @param command - The command to insert (e.g., "/clear")
 * @param replaceSlash - Whether to replace the preceding '/' character
 */
export const insertSlashCommand = (
  command: string,
  onTextChange: (updater: (prev: string) => string) => void,
  replaceSlash: boolean = false,
  inputAdapter?: QuickPanelInputAdapter
) => {
  if (inputAdapter) {
    const currentText = inputAdapter.getText()
    const cursorPosition = inputAdapter.getCursorOffset?.() ?? currentText.length

    if (replaceSlash) {
      const lastSlashIndex = currentText.slice(0, cursorPosition).lastIndexOf('/')
      if (lastSlashIndex !== -1 && cursorPosition > lastSlashIndex) {
        inputAdapter.deleteTriggerRange({ from: lastSlashIndex, to: cursorPosition })
      }
    }

    inputAdapter.insertText(`${command} `)
    inputAdapter.focus()
    return
  }

  onTextChange((prev: string) => {
    const separator = prev.length > 0 && !/\s$/.test(prev) ? ' ' : ''
    return `${prev}${separator}${command} `
  })
}

/**
 * Slash Commands Tool
 *
 * Integrates Agent Session slash commands into the Inputbar.
 * Provides both a button UI and Composer menu integration.
 * Only visible in Agent Session (TopicType.Session).
 *
 * Menu structure:
 * - First level: "Slash Commands" parent menu item in the Composer menu.
 * - "/" root suggestion: Individual slash commands are listed directly.
 */
const slashCommandsTool = defineTool({
  key: 'slash_commands',
  label: (t) => t('chat.input.slash_commands.title'),

  // Only visible in Agent Session
  visibleInScopes: [TopicType.Session],

  dependencies: {
    actions: ['onTextChange'] as const
  },

  composer: {
    menuItems: {
      createItems: (context) => {
        const { t, session, actions, quickPanelController } = context
        const slashCommands = getBuiltinSlashCommands(session?.agentType)

        if (slashCommands.length === 0) {
          return []
        }

        const popoverLauncher: ComposerToolLauncher = {
          id: 'slash-commands',
          kind: 'panel' as const,
          sources: ['popover'] as const,
          order: 20,
          label: t('chat.input.slash_commands.title'),
          description: t('chat.input.slash_commands.description', 'Agent session slash commands'),
          icon: <Terminal size={16} />,
          action: ({ quickPanel, inputAdapter }) => {
            quickPanel.close('select')
            setTimeout(() => {
              quickPanelController.open({
                title: t('chat.input.slash_commands.title'),
                symbol: QuickPanelReservedSymbol.SlashCommands,
                list: slashCommands.map((cmd) => ({
                  label: cmd.command,
                  description: cmd.description || '',
                  icon: <Terminal size={16} />,
                  filterText: `${cmd.command} ${cmd.description || ''}`,
                  action: ({ inputAdapter: panelInputAdapter }) => {
                    insertSlashCommand(cmd.command, actions.onTextChange, false, panelInputAdapter ?? inputAdapter)
                  }
                }))
              })
            }, 0)
          }
        }

        const rootLaunchers: ComposerToolLauncher[] = slashCommands.map((cmd, index) => ({
          id: `slash-command:${cmd.command}`,
          kind: 'command' as const,
          sources: ['root-panel'] as const,
          order: 20 + (index + 1) / 100,
          label: cmd.command,
          description: cmd.description || '',
          icon: <Terminal size={16} />,
          action: ({ inputAdapter }) => {
            insertSlashCommand(cmd.command, actions.onTextChange, false, inputAdapter)
          }
        }))

        return [popoverLauncher, ...rootLaunchers]
      }
    }
  }
})

// Register the tool
registerTool(slashCommandsTool)

export default slashCommandsTool
