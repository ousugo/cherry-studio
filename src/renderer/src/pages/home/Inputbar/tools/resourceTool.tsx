import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import ResourceButton from './components/ResourceButton'
import ResourceQuickPanelManager from './components/ResourceQuickPanelManager'

/**
 * Resource Tool
 *
 * Allows users to search and select files from accessible paths.
 * Uses @ trigger (same symbol as MentionModels, but different scope).
 * Only visible in Agent Session (TopicType.Session).
 */
const resourceTool = defineTool({
  key: 'resource_panel',
  label: (t) => t('chat.input.resource_panel.title'),
  visibleInScopes: [TopicType.Session],

  dependencies: {
    state: ['files'] as const,
    actions: ['onTextChange', 'setFiles'] as const
  },

  render: function ResourceToolRender(context) {
    const { quickPanel, launcher, quickPanelController, state, actions, session } = context
    const { onTextChange, setFiles } = actions

    // Get accessible paths from session data
    const accessiblePaths = session?.accessiblePaths ?? []

    // Only render if we have accessible paths
    if (accessiblePaths.length === 0) {
      return null
    }

    return (
      <ResourceButton
        quickPanel={quickPanel}
        launcher={launcher}
        quickPanelController={quickPanelController}
        accessiblePaths={accessiblePaths}
        files={state.files}
        setFiles={setFiles}
        setText={onTextChange as React.Dispatch<React.SetStateAction<string>>}
      />
    )
  },

  quickPanelManager: ResourceQuickPanelManager
})

registerTool(resourceTool)

export default resourceTool
