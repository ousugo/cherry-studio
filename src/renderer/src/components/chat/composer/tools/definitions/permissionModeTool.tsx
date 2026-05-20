import {
  defineTool,
  registerTool,
  type ToolRenderContext,
  TopicType
} from '@renderer/components/chat/composer/tools/types'
import { permissionModeCards } from '@renderer/config/agent'
import { useAgent } from '@renderer/hooks/agents/useAgent'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgent'
import { computeModeDefaults, defaultConfiguration } from '@renderer/pages/agents/AgentSettings/shared'
import type { PermissionMode } from '@renderer/types'
import { uniq } from 'lodash'
import { FolderPen, Pointer, RefreshCcw, Route } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'

const getPermissionModeIcon = (mode: PermissionMode): ReactNode => {
  switch (mode) {
    case 'default':
      return <Pointer size={18} color="#00b96b" />
    case 'plan':
      return <Route size={18} color="#faad14" />
    case 'acceptEdits':
      return <FolderPen size={18} color="#52c41a" />
    case 'bypassPermissions':
      return <RefreshCcw size={18} color="#722ed1" />
    default:
      return <Pointer size={18} color="#00b96b" />
  }
}

const SYMBOL = 'permission-mode'

type PermissionModeContext = ToolRenderContext<readonly [], readonly []>

const usePermissionModeToolController = (context: PermissionModeContext) => {
  const { t, launcher, session: sessionContext, quickPanelController } = context
  const agentId = sessionContext?.agentId
  const { agent } = useAgent(agentId ?? '')
  const { updateAgent } = useUpdateAgent()

  // Permission mode, allowedTools, and the tool catalog all live on the agent
  // — sessions are pure instances. UI writes the agent record directly.
  const currentMode = agent?.configuration?.permission_mode ?? 'default'
  const availableTools = useMemo(() => agent?.tools ?? [], [agent?.tools])

  const handleSelectMode = useCallback(
    (nextMode: PermissionMode) => {
      if (!agentId || !agent || nextMode === currentMode) return

      const configuration = agent.configuration ?? defaultConfiguration
      const currentAutoToolIds = computeModeDefaults(currentMode, availableTools)
      const nextAutoToolIds = computeModeDefaults(nextMode, availableTools)

      const currentAllowed = agent.allowedTools ?? []
      const userAddedIds = currentAllowed.filter((id) => !currentAutoToolIds.includes(id))
      const mergedAllowed = uniq([...nextAutoToolIds, ...userAddedIds])

      const updatedConfiguration = { ...configuration, permission_mode: nextMode }

      // Disable soul mode when switching away from bypassPermissions
      if (nextMode !== 'bypassPermissions' && configuration.soul_enabled === true) {
        updatedConfiguration.soul_enabled = false
      }

      void updateAgent(
        {
          id: agentId,
          configuration: updatedConfiguration,
          allowedTools: mergedAllowed
        },
        { showSuccessToast: false }
      )
    },
    [currentMode, agent, agentId, availableTools, updateAgent]
  )

  const handleClick = useCallback(() => {
    // Toggle: close if already open with the same symbol
    if (quickPanelController.isVisible && quickPanelController.symbol === SYMBOL) {
      quickPanelController.close('esc')
      return
    }

    quickPanelController.open({
      title: t('agent.settings.permissionMode.title', 'Permission Mode'),
      symbol: SYMBOL,
      list: permissionModeCards.map((card) => ({
        label: t(card.titleKey, card.titleFallback),
        description: t(card.descriptionKey, card.descriptionFallback),
        icon: getPermissionModeIcon(card.mode),
        isSelected: card.mode === currentMode,
        action: () => handleSelectMode(card.mode)
      }))
    })
  }, [quickPanelController, t, currentMode, handleSelectMode])

  const modeCard = permissionModeCards.find((card) => card.mode === currentMode)
  const tooltipTitle = modeCard ? t(modeCard.titleKey, modeCard.titleFallback) : ''

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'permission-mode',
        kind: 'panel',
        sources: ['popover', 'root-panel'],
        order: 80,
        label: t('agent.settings.permissionMode.title', 'Permission Mode'),
        description: tooltipTitle,
        icon: getPermissionModeIcon(currentMode),
        action: handleClick
      }
    ])
  }, [currentMode, handleClick, launcher, t, tooltipTitle])

  return { currentMode, handleClick, tooltipTitle }
}

const PermissionModeComposerRuntime = ({ context }: { context: PermissionModeContext }) => {
  usePermissionModeToolController(context)
  return null
}

const permissionModeTool = defineTool({
  key: 'permission_mode',
  label: (t) => t('agent.settings.permissionMode.title', 'Permission Mode'),
  visibleInScopes: [TopicType.Session],

  composer: {
    runtime: ({ context }) => <PermissionModeComposerRuntime context={context} />
  }
})

registerTool(permissionModeTool)

export default permissionModeTool
