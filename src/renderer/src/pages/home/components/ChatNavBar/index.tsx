import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { t } from 'i18next'
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
        <div className="flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden pr-2">
          <div className="flex shrink-0 items-center">
            {showSidebar ? (
              <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </Tooltip>
            ) : (
              <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
                <NavbarIcon onClick={toggleShowSidebar}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </Tooltip>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <ChatNavbarContent assistantId={assistantId} topicId={topicId} onOpenSettings={onOpenSettings} />
          </div>
        </div>
      </NarrowLayout>
    </NavbarHeader>
  )
}

export default HeaderNavbar
