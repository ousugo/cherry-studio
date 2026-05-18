import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useTranslation } from 'react-i18next'

const NarrowLayoutToggleButton = () => {
  const { t } = useTranslation()
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')

  const handleNarrowModeToggle = () => {
    void setNarrowMode(!narrowMode)
  }

  return (
    <Tooltip content={t('navbar.expand')} delay={800}>
      <NavbarIcon className="max-[1000px]:hidden" onClick={handleNarrowModeToggle}>
        <i className="iconfont icon-icon-adaptive-width"></i>
      </NavbarIcon>
    </Tooltip>
  )
}

export default NarrowLayoutToggleButton
