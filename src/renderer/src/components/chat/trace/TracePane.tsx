import { TracePage } from './TracePage'

export interface TracePanePayload {
  topicId: string
  traceId: string
  modelName?: string
}

export function TracePane({ payload }: { payload: TracePanePayload | null }) {
  if (!payload) {
    return null
  }

  return (
    <TracePage
      topicId={payload.topicId}
      traceId={payload.traceId}
      modelName={payload.modelName}
      reload={`${payload.topicId}:${payload.traceId}:${payload.modelName ?? ''}`}
    />
  )
}
