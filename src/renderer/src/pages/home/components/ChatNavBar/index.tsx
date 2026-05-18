import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { t } from 'i18next'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'
import ChatNavbarContent from './ChatNavbarContent'

interface Props {
  /** `undefined` when the topic has no associated assistant. */
  assistantId: string | undefined
  topicId: string
  onOpenSettings: () => void
}

const HeaderNavbar: FC<Props> = ({ assistantId, topicId, onOpenSettings }) => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const [narrowMode] = usePreference('chat.narrow_mode')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <NarrowLayout narrowMode={narrowMode} className="h-full">
        <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
          {showSidebar && (
            <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
              <NavbarIcon onClick={toggleShowSidebar}>
                <PanelLeftClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
          {!showSidebar && (
            <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
              <NavbarIcon onClick={toggleShowSidebar}>
                <PanelRightClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
          <ChatNavbarContent assistantId={assistantId} topicId={topicId} onOpenSettings={onOpenSettings} />
        </div>
      </NarrowLayout>
    </NavbarHeader>
  )
}

export default HeaderNavbar
