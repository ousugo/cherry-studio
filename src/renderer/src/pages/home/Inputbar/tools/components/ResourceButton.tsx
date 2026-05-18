import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolLauncherApi, ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata } from '@renderer/types'
import { Tooltip } from 'antd'
import { FolderOpen } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useResourcePanel } from './useResourcePanel'

interface Props {
  quickPanel: ToolQuickPanelApi
  launcher: ToolLauncherApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  files: FileMetadata[]
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  setText: React.Dispatch<React.SetStateAction<string>>
}

const ResourceButton: FC<Props> = ({
  quickPanel,
  launcher,
  quickPanelController,
  accessiblePaths,
  files,
  setFiles,
  setText
}) => {
  const { t } = useTranslation()

  const { handleOpenQuickPanel } = useResourcePanel(
    {
      quickPanel,
      launcher,
      quickPanelController,
      accessiblePaths,
      files,
      setFiles,
      setText
    },
    'button'
  )

  return (
    <Tooltip placement="top" title={t('chat.input.resource_panel.title')} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        aria-label={t('chat.input.resource_panel.title')}
        icon={<FolderOpen size={18} />}></ActionIconButton>
    </Tooltip>
  )
}

export default memo(ResourceButton)
