import SidePanelDrawer from '@renderer/components/chat/shell/SidePanelDrawer'
import { TopView } from '@renderer/components/TopView'
import { useTranslation } from 'react-i18next'

import AgentSidePanel from '../AgentSidePanel'

interface Props {
  resolve: () => void
}

const PopupContainer = ({ resolve }: Props) => {
  const { t } = useTranslation()

  return (
    <SidePanelDrawer
      title={t('shortcut.topic.toggle_show_topics')}
      resolve={resolve}
      onCloseReady={(onClose) => {
        AgentSidePanelDrawer.hide = onClose
      }}>
      {(onClose) => <AgentSidePanel onSelectItem={onClose} />}
    </SidePanelDrawer>
  )
}

const TopViewKey = 'AgentSidePanelDrawer'

export default class AgentSidePanelDrawer {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show() {
    return new Promise<void>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={() => {
            resolve()
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
