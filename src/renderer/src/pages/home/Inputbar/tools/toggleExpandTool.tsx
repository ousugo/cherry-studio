import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolRenderContext } from '@renderer/pages/home/Inputbar/types'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { Tooltip } from 'antd'
import { Maximize, Minimize } from 'lucide-react'
import React, { useCallback, useEffect } from 'react'

type ToggleExpandRenderContext = ToolRenderContext<readonly ['isExpanded'], readonly ['toggleExpanded']>

const ToggleExpandTool: React.FC<{ context: ToggleExpandRenderContext }> = ({ context }) => {
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

  return (
    <Tooltip
      placement="top"
      title={isExpanded ? t('chat.input.collapse') : t('chat.input.expand')}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton
        onClick={handleToggle}
        icon={isExpanded ? <Minimize size={18} /> : <Maximize size={18} />}></ActionIconButton>
    </Tooltip>
  )
}

const toggleExpandTool = defineTool({
  key: 'toggle_expand',
  label: (t) => t('chat.input.expand'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  dependencies: {
    state: ['isExpanded'] as const,
    actions: ['toggleExpanded'] as const
  },
  render: (context) => <ToggleExpandTool context={context} />
})

registerTool(toggleExpandTool)

export default toggleExpandTool
