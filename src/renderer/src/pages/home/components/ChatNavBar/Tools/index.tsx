import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { GitBranch, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ToolsProps {
  onOpenTopicFlow?: () => void | Promise<void>
}

const Tools = ({ onOpenTopicFlow }: ToolsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-0.5">
      {onOpenTopicFlow && (
        <Tooltip content={t('chat.message.new.branch.label')} delay={800}>
          <NavbarIcon aria-label={t('chat.message.new.branch.label')} onClick={() => void onOpenTopicFlow()}>
            <GitBranch size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
      <Tooltip content={t('chat.assistant.search.placeholder')} delay={800}>
        <NavbarIcon aria-label={t('chat.assistant.search.placeholder')} onClick={() => SearchPopup.show()}>
          <Search size={18} />
        </NavbarIcon>
      </Tooltip>
    </div>
  )
}

export default Tools
