import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useOverlayTriggerTooltip } from '@renderer/hooks/useOverlayTriggerTooltip'
import { GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ToolsProps {
  onOpenTopicFlow?: () => void | Promise<void>
}

const Tools = ({ onOpenTopicFlow }: ToolsProps) => {
  const { t } = useTranslation()
  const topicFlowTooltip = useOverlayTriggerTooltip()

  return (
    <div className="flex items-center gap-0.5">
      {onOpenTopicFlow && (
        <Tooltip content={t('chat.message.new.branch.label')} delay={800} {...topicFlowTooltip.tooltipProps}>
          <NavbarIcon
            aria-label={t('chat.message.new.branch.label')}
            onClick={(event) => {
              topicFlowTooltip.suppress(event.currentTarget)
              void onOpenTopicFlow()
            }}
            {...topicFlowTooltip.triggerProps}>
            <GitBranch size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
    </div>
  )
}

export default Tools
