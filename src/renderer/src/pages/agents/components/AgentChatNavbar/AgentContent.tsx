import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { SidebarCollapseIcon, SidebarExpandIcon } from '@renderer/components/Icons'
import NavbarIcon from '@renderer/components/NavbarIcon'
import type { AgentEntity } from '@shared/data/types/agent'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity | null
  tools?: ReactNode
  showSidebarControls?: boolean
}

const AgentContent = ({ activeAgent, tools, showSidebarControls = true }: AgentContentProps) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)

  return (
    <div className="flex w-full justify-between">
      <div className="flex min-w-0 shrink items-center">
        {showSidebarControls && (
          <>
            {showSidebar && (
              <Tooltip title={t('navbar.hide_sidebar')} delay={800}>
                <NavbarIcon tone="conversation" active aria-pressed={showSidebar} onClick={toggleShowSidebar}>
                  <SidebarCollapseIcon />
                </NavbarIcon>
              </Tooltip>
            )}
            {!showSidebar && (
              <Tooltip title={t('navbar.show_sidebar')} delay={800} placement="right">
                <NavbarIcon
                  tone="conversation"
                  aria-pressed={showSidebar}
                  onClick={toggleShowSidebar}
                  style={{ marginRight: 2 }}>
                  <SidebarExpandIcon />
                </NavbarIcon>
              </Tooltip>
            )}
          </>
        )}
      </div>
      <div className="flex items-center">{activeAgent && <Tools>{tools}</Tools>}</div>
    </div>
  )
}

export default AgentContent
