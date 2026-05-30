import SidePanelDrawer from '@renderer/components/chat/shell/SidePanelDrawer'
import { TopView } from '@renderer/components/TopView'
import type { Topic } from '@renderer/types'
import { useTranslation } from 'react-i18next'

import HomeTabs from '../Tabs'
import type { AddNewTopicPayload } from '../types'

interface HomeSidePanelDrawerOptions {
  activeTopic: Topic
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  setActiveTopic: (topic: Topic) => void
}

interface Props extends HomeSidePanelDrawerOptions {
  resolve: () => void
}

const PopupContainer = ({ activeTopic, onNewTopic, onOpenHistory, resolve, setActiveTopic }: Props) => {
  const { t } = useTranslation()

  const handleSelectTopic = (topic: Topic, onClose: () => void) => {
    setActiveTopic(topic)
    onClose()
  }

  const handleNewTopic = async (payload: AddNewTopicPayload | undefined, onClose: () => void) => {
    await onNewTopic?.(payload)
    onClose()
  }

  const handleOpenHistory = (origin: DOMRectReadOnly | undefined, onClose: () => void) => {
    onOpenHistory?.(origin)
    onClose()
  }

  return (
    <SidePanelDrawer
      title={t('shortcut.topic.toggle_show_topics')}
      resolve={resolve}
      onCloseReady={(onClose) => {
        HomeSidePanelDrawer.hide = onClose
      }}>
      {(onClose) => (
        <HomeTabs
          activeTopic={activeTopic}
          setActiveTopic={(topic) => handleSelectTopic(topic, onClose)}
          onOpenHistory={(origin) => handleOpenHistory(origin, onClose)}
          onNewTopic={(payload) => handleNewTopic(payload, onClose)}
        />
      )}
    </SidePanelDrawer>
  )
}

const TopViewKey = 'HomeSidePanelDrawer'

export default class HomeSidePanelDrawer {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show(options: HomeSidePanelDrawerOptions) {
    return new Promise<void>((resolve) => {
      TopView.show(
        <PopupContainer
          {...options}
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
