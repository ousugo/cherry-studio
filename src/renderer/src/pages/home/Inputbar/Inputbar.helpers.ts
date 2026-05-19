export type AddNewTopicPayload = {
  assistantId?: string | null
}

export function resolveNewTopicAssistantId(activeAssistantId: string | undefined, payload?: AddNewTopicPayload) {
  if (payload && 'assistantId' in payload) {
    return payload.assistantId ?? undefined
  }

  return activeAssistantId
}
