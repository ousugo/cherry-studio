import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'

import { McpToolsRuntime } from '../components/McpToolsButton'

const mcpToolsTool = defineTool({
  key: 'mcp_tools',
  label: (t) => t('settings.mcp.title'),
  visibleInScopes: [TopicType.Chat],
  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },
  composer: {
    runtime: ({ context: { assistant, actions, launcher, model, t } }) => {
      if (!assistant) return null

      const isToolUseAvailable = isSupportedToolUse(assistant, model) || isPromptToolUse(assistant)

      return (
        <McpToolsRuntime
          assistantId={assistant.id}
          launcher={launcher}
          setInputValue={actions.onTextChange}
          resizeTextArea={actions.resizeTextArea}
          disabled={!isToolUseAvailable}
          disabledReason={isToolUseAvailable ? undefined : t('chat.input.mcp_unavailable')}
        />
      )
    }
  }
})

registerTool(mcpToolsTool)

export default mcpToolsTool
