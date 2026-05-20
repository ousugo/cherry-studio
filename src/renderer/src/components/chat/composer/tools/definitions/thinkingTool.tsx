import { ThinkingToolRuntime } from '@renderer/components/chat/composer/tools/components/ThinkingButton'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { isReasoningModel } from '@renderer/config/models'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('chat.input.thinking.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  condition: ({ model }) => {
    return isReasoningModel(model)
  },
  composer: {
    runtime: ({ context: { assistant, model, launcher, session } }) => (
      <ThinkingToolRuntime
        launcher={launcher}
        model={model}
        assistantId={assistant.id}
        reasoningEffort={session?.reasoningEffort}
        onReasoningEffortChange={session?.onReasoningEffortChange}
      />
    )
  }
})

registerTool(thinkingTool)

export default thinkingTool
