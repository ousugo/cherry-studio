import type { ToolRenderContext } from '@renderer/components/chat/composer/tools/types'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'
import { Maximize, Minimize } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect } from 'react'

type ToggleExpandRenderContext = ToolRenderContext<readonly ['isExpanded'], readonly ['toggleExpanded']>

const useToggleExpandToolController = (context: ToggleExpandRenderContext) => {
  const { actions, state, t } = context
  const isExpanded = Boolean(state.isExpanded)

  const handleToggle = useCallback(() => {
    actions.toggleExpanded?.()
  }, [actions])

  useEffect(() => {
    return context.launcher.registerLaunchers([
      {
        id: 'toggle-expand',
        kind: 'command',
        sources: ['popover'],
        order: 90,
        label: isExpanded ? t('chat.input.collapse') : t('chat.input.expand'),
        description: '',
        icon: isExpanded ? <Minimize size={18} /> : <Maximize size={18} />,
        active: isExpanded,
        action: handleToggle
      }
    ])
  }, [context.launcher, handleToggle, isExpanded, t])

  return { handleToggle, isExpanded, t }
}

const ToggleExpandComposerRuntime: React.FC<{ context: ToggleExpandRenderContext }> = ({ context }) => {
  useToggleExpandToolController(context)
  return null
}

const toggleExpandTool = defineTool({
  key: 'toggle_expand',
  label: (t) => t('chat.input.expand'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  dependencies: {
    state: ['isExpanded'] as const,
    actions: ['toggleExpanded'] as const
  },
  composer: {
    runtime: ({ context }) => <ToggleExpandComposerRuntime context={context} />
  }
})

registerTool(toggleExpandTool)

export default toggleExpandTool
