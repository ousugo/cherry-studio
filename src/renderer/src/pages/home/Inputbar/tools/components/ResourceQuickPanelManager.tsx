import type { ToolActionKey, ToolRenderContext, ToolStateKey } from '@renderer/pages/home/Inputbar/types'
import type React from 'react'

import { useResourcePanel } from './useResourcePanel'

interface ManagerProps {
  context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
}

const ResourceQuickPanelManager = ({ context }: ManagerProps) => {
  const {
    quickPanel,
    launcher,
    quickPanelController,
    state: { files },
    actions: { onTextChange, setFiles },
    session
  } = context

  // Get accessible paths from session data
  const accessiblePaths = session?.accessiblePaths ?? []

  // Always call hooks unconditionally (React rules)
  useResourcePanel(
    {
      quickPanel,
      launcher,
      quickPanelController,
      accessiblePaths,
      agentId: session?.agentId,
      files,
      setFiles,
      setText: onTextChange as React.Dispatch<React.SetStateAction<string>>
    },
    'manager'
  )

  return null
}

export default ResourceQuickPanelManager
