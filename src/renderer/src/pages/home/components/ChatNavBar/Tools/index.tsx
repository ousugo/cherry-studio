import { Tooltip } from '@cherrystudio/ui'
import NarrowLayoutToggleButton from '@renderer/components/chat/layout/NarrowLayoutToggleButton'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const Tools = () => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-0.5">
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
