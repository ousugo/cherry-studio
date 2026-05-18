import { usePreference } from '@data/hooks/usePreference'
import type { ResourceListRevealRequest } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import type { FC } from 'react'
import styled from 'styled-components'

import Topics from './TopicsTab'

interface Props {
  activeTopic: Topic
  onOpenHistory?: (origin?: DOMRectReadOnly) => void
  setActiveTopic: (topic: Topic) => void
  position: 'left' | 'right'
  revealRequest?: ResourceListRevealRequest
  style?: React.CSSProperties
}

const HomeTabs: FC<Props> = ({ activeTopic, onOpenHistory, setActiveTopic, position, revealRequest, style }) => {
  const [topicPosition] = usePreference('topic.position')

  const border = position === 'right' ? { borderTopLeftRadius: 0 } : undefined

  return (
    <Container
      style={{ ...border, ...style }}
      className={classNames('home-tabs', { right: position === 'right' && topicPosition === 'right' })}>
      <TabContent className="home-tabs-content">
        <Topics
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          position={position}
          onOpenHistory={onOpenHistory}
          revealRequest={revealRequest}
        />
      </TabContent>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  width: var(--assistants-width);
  transition: width 0.3s;
  height: calc(100vh - var(--navbar-height));
  position: relative;

  &.right {
    height: calc(100vh - var(--navbar-height));
  }

  overflow: hidden;
  .collapsed {
    width: 0;
    border-left: none;
  }
`

const TabContent = styled.div`
  display: flex;
  transition: width 0.3s;
  flex: 1;
  flex-direction: column;
  overflow-y: hidden;
  overflow-x: hidden;
`

export default HomeTabs
