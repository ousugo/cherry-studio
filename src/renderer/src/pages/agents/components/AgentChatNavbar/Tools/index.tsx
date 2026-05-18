import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import NarrowLayoutToggleButton from '@renderer/components/chat/layout/NarrowLayoutToggleButton'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import ArtifactPaneToggleButton from './ArtifactPaneToggleButton'
import SettingsButton from './SettingsButton'

interface Props {
  onOpenSettings: () => void
  artifactPaneOpen: boolean
  onToggleArtifactPane: () => void
}

const Tools = ({ onOpenSettings, artifactPaneOpen, onToggleArtifactPane }: Props) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const [topicPosition] = usePreference('topic.position')

  return (
    <div className="flex items-center gap-2">
      <SettingsButton onOpenSettings={onOpenSettings} />
      <NarrowLayoutToggleButton />
      <ArtifactPaneToggleButton open={artifactPaneOpen} onToggle={onToggleArtifactPane} />
      {/* TODO: Add search button back when global search supports agent messages */}
      {topicPosition === 'right' && (
        <Tooltip content={showSidebar ? t('navbar.hide_sidebar') : t('navbar.show_sidebar')} delay={2000}>
          <NavbarIcon onClick={toggleShowSidebar}>
            {showSidebar ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
          </NavbarIcon>
        </Tooltip>
      )}
    </div>
  )
}

export default Tools
