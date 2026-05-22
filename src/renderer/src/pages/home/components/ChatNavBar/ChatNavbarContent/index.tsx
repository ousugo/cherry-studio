import type { FC } from 'react'

import Tools from '../Tools'

interface ChatNavbarContentProps {
  onOpenTopicFlow?: () => void | Promise<void>
}

const ChatNavbarContent: FC<ChatNavbarContentProps> = ({ onOpenTopicFlow }) => {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between">
      <Tools onOpenTopicFlow={onOpenTopicFlow} />
    </div>
  )
}

export default ChatNavbarContent
