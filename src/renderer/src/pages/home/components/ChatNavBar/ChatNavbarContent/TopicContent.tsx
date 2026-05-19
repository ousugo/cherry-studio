import Tools from '../Tools'

type TopicContentProps = {
  /** `undefined` when the topic has no associated assistant. */
  assistantId: string | undefined
  topicId: string
  onOpenSettings: () => void
}

const TopicContent = ({ onOpenSettings }: TopicContentProps) => {
  return <Tools onOpenSettings={onOpenSettings} />
}

export default TopicContent
