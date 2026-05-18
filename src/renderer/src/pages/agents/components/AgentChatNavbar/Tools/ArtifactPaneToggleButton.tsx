import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { t } from 'i18next'
import { Columns2 } from 'lucide-react'

interface ArtifactPaneToggleButtonProps {
  open: boolean
  onToggle: () => void
}

const ArtifactPaneToggleButton = ({ open, onToggle }: ArtifactPaneToggleButtonProps) => {
  return (
    <Tooltip content={t('agent.preview_pane.toggle')} delay={800}>
      <NavbarIcon
        onClick={onToggle}
        aria-pressed={open}
        aria-label={t('agent.preview_pane.toggle')}
        data-state={open ? 'open' : 'closed'}>
        <Columns2 size={18} />
      </NavbarIcon>
    </Tooltip>
  )
}

export default ArtifactPaneToggleButton
