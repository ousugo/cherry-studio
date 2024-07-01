export type Agent = {
  id: string
  name: string
  description: string
  conversations: string[]
}

export type Message = {
  id: string
  role: 'user' | 'agent'
  content: string
  agentId: string
  conversationId: string
  createdAt: string
}

export type Conversation = {
  id: string
  messages: Message[]
}

export type User = {
  id: string
  name: string
  avatar: string
  email: string
}