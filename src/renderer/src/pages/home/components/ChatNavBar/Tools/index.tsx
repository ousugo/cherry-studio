import { Tooltip } from '@cherrystudio/ui'
import NarrowLayoutToggleButton from '@renderer/components/chat/layout/NarrowLayoutToggleButton'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import SettingsButton from './SettingsButton'

interface ToolsProps {
  onOpenSettings: () => void
}

const Tools = ({ onOpenSettings }: ToolsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-0.5">
      <SettingsButton onOpenSettings={onOpenSettings} />
      <NarrowLayoutToggleButton />
      <Tooltip content={t('chat.assistant.search.placeholder')} delay={800}>
        <NavbarIcon onClick={() => SearchPopup.show()}>
          <Search size={18} />
        </NavbarIcon>
      </Tooltip>
    </div>
  )
}

export default Tools
