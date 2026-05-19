import { usePreference } from '@data/hooks/usePreference'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import NarrowLayout from '@renderer/components/chat/layout/NarrowLayout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { cn } from '@renderer/utils'
import type { AgentEntity } from '@shared/data/types/agent'

import AgentContent from './AgentContent'

interface Props {
  activeAgent: AgentEntity | null
  onOpenSettings: () => void
  artifactPaneOpen: boolean
  onToggleArtifactPane: () => void
  className?: string
}

const AgentChatNavbar = ({ activeAgent, onOpenSettings, artifactPaneOpen, onToggleArtifactPane, className }: Props) => {
  const [narrowMode] = usePreference('chat.narrow_mode')

  useShortcut('general.search', () => {
    void SearchPopup.show()
  })

  return (
    <NavbarHeader className={cn('agent-navbar h-(--navbar-height)', className)}>
      <NarrowLayout narrowMode={narrowMode} className="h-full">
        <div className="flex h-full min-w-0 flex-1 shrink items-center overflow-auto">
          <AgentContent
            activeAgent={activeAgent}
            onOpenSettings={onOpenSettings}
            artifactPaneOpen={artifactPaneOpen}
            onToggleArtifactPane={onToggleArtifactPane}
          />
        </div>
      </NarrowLayout>
    </NavbarHeader>
  )
}

export default AgentChatNavbar
