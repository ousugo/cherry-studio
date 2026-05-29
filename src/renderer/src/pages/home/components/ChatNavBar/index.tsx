import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import { t } from 'i18next'
import type { FC } from 'react'

import NavbarIcon from '../../../../components/NavbarIcon'

interface HeaderNavbarProps {
  showSidebarControls?: boolean
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({ showSidebarControls = true }) => {
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  return (
    <NavbarHeader className="home-navbar" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div className="flex shrink-0 items-center">
          {showSidebarControls &&
            (showSidebar ? (
              <Tooltip placement="bottom" content={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon tone="conversation" active aria-pressed={showSidebar} onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </Tooltip>
            ) : (
              <Tooltip placement="bottom" content={t('navbar.show_sidebar')} delay={800}>
                <NavbarIcon
                  tone="conversation"
                  aria-pressed={showSidebar}
                  onClick={toggleShowSidebar}
                  style={{ marginRight: 2 }}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </Tooltip>
            ))}
        </div>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
