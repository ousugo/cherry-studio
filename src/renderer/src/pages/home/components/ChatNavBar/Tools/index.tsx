import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import NarrowLayoutToggleButton from '@renderer/components/chat/layout/NarrowLayoutToggleButton'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import SettingsButton from './SettingsButton'

interface ToolsProps {
  onOpenSettings: () => void
}

const Tools = ({ onOpenSettings }: ToolsProps) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const [topicPosition] = usePreference('topic.position')

  return (
    <div className="flex items-center gap-2">
      <SettingsButton onOpenSettings={onOpenSettings} />
      <NarrowLayoutToggleButton />
      <Tooltip content={t('chat.assistant.search.placeholder')} delay={800}>
        <NavbarIcon onClick={() => SearchPopup.show()}>
          <Search size={18} />
        </NavbarIcon>
      </Tooltip>
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
