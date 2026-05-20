import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'

import { MCPToolsRuntime } from '../components/MCPToolsButton'

const mcpToolsTool = defineTool({
  key: 'mcp_tools',
  label: (t) => t('settings.mcp.title'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ assistant, model }) =>
    !!assistant && (isSupportedToolUse(assistant, model) || isPromptToolUse(assistant)),
  dependencies: {
    actions: ['onTextChange', 'resizeTextArea'] as const
  },
  composer: {
    runtime: ({ context: { assistant, actions, launcher } }) => (
      <MCPToolsRuntime
        assistantId={assistant!.id}
        launcher={launcher}
        setInputValue={actions.onTextChange}
        resizeTextArea={actions.resizeTextArea}
      />
    )
  }
})

registerTool(mcpToolsTool)

export default mcpToolsTool
