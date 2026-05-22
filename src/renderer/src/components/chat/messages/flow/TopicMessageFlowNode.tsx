import { cn } from '@renderer/utils'
import type { MessageRole, MessageStatus } from '@shared/data/types/message'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import dayjs from 'dayjs'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TopicMessageFlowNodeModel } from './types'

const roleClassNames: Record<MessageRole, string> = {
  user: 'border-success/35 bg-success/8',
  assistant: 'border-info/35 bg-info/8',
  system: 'border-border bg-muted/45'
}

const statusDotClassNames: Record<MessageStatus, string> = {
  pending: 'bg-warning',
  success: 'bg-success',
  error: 'bg-destructive',
  paused: 'bg-foreground-muted'
}

function getModelShortLabel(modelId?: string | null) {
  if (!modelId) return ''

  const value = modelId.trim()
  if (!value) return ''

  return value.split('/').at(-1)?.split(':').at(-1) ?? value
}

function formatNodeTime(createdAt: string) {
  const value = dayjs(createdAt)
  return value.isValid() ? value.format('MM/DD HH:mm') : createdAt || '-'
}

function useRoleLabel(role: MessageRole) {
  const { t } = useTranslation()

  if (role === 'user') return t('export.user')
  if (role === 'assistant') return t('export.assistant')
  return t('assistants.tag.system')
}

function useStatusLabel(status: MessageStatus) {
  const { t } = useTranslation()

  if (status === 'pending') return t('common.loading')
  if (status === 'success') return t('common.completed')
  if (status === 'error') return t('common.error')
  return t('agent.task.status.paused')
}

const TopicMessageFlowNode = ({ data, selected }: NodeProps<TopicMessageFlowNodeModel>) => {
  const roleLabel = useRoleLabel(data.role)
  const statusLabel = useStatusLabel(data.status)
  const modelLabel = getModelShortLabel(data.modelId)
  const timeLabel = formatNodeTime(data.createdAt)

  return (
    <div
      className={cn(
        'group/topic-message-flow-node relative w-[220px] rounded-md border bg-card px-3 py-2 shadow-xs transition-[border-color,box-shadow,opacity]',
        'focus-within:ring-2 focus-within:ring-ring/35',
        roleClassNames[data.role],
        data.isActive && 'border-primary shadow-sm ring-2 ring-primary/20',
        selected && !data.isActive && 'ring-2 ring-ring/25',
        data.isInactiveBranch && 'opacity-55'
      )}
      data-active={data.isActive ? 'true' : 'false'}
      data-message-id={data.messageId}
      data-on-active-path={data.isOnActivePath ? 'true' : 'false'}>
      <Handle className="opacity-0" isConnectable={false} position={Position.Top} type="target" />

      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-3xs bg-background/70 px-1.5 py-0.5 font-medium text-[10px] text-foreground leading-3.5">
            {roleLabel}
          </span>
          {modelLabel ? (
            <span className="truncate font-mono text-[10px] text-foreground-muted leading-3.5">{modelLabel}</span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 min-h-9 text-[12px] text-foreground leading-4">{data.preview || '-'}</p>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-foreground-muted leading-3.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('size-1.5 shrink-0 rounded-full', statusDotClassNames[data.status])} />
          <span className="truncate">{statusLabel}</span>
        </span>
        <time className="shrink-0" dateTime={data.createdAt}>
          {timeLabel}
        </time>
      </div>

      <Handle className="opacity-0" isConnectable={false} position={Position.Bottom} type="source" />
    </div>
  )
}

export default memo(TopicMessageFlowNode)
