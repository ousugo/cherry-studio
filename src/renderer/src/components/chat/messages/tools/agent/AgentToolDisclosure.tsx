import { cn } from '@renderer/utils'
import { Minus, Plus } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { StreamingContext } from './GenericTools'

export function AgentToolDisclosureLabel({
  label,
  trailing,
  labelClassName,
  trailingClassName
}: {
  label: ReactNode
  trailing?: ReactNode
  labelClassName?: string
  trailingClassName?: string
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <div className={labelClassName ?? 'min-w-0'}>{label}</div>
      {trailing && <div className={trailingClassName ?? 'shrink-0'}>{trailing}</div>}
    </div>
  )
}

export function AgentToolDisclosure({
  className,
  defaultActiveKey = [],
  isStreaming = false,
  item,
  onOpenDetails,
  showInlineDetails = true
}: {
  className?: string
  defaultActiveKey?: string[]
  isStreaming?: boolean
  item: ToolDisclosureItem
  onOpenDetails?: () => void
  showInlineDetails?: boolean
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const itemKey = String(item.key)
  const canExpand = showInlineDetails && item.children !== undefined && item.children !== null
  const isInteractive = canExpand || !!onOpenDetails
  const [isExpanded, setIsExpanded] = useState(() => defaultActiveKey.includes(itemKey))
  const toggleExpanded = () => {
    if (!canExpand) return
    setIsExpanded((expanded) => !expanded)
  }
  const openOrToggle = () => {
    if (onOpenDetails) {
      onOpenDetails()
      return
    }
    toggleExpanded()
  }
  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isInteractive) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openOrToggle()
  }

  return (
    <StreamingContext value={isStreaming}>
      <div
        className={cn(
          'w-full overflow-hidden rounded-[7px] border border-border bg-background',
          className,
          item.classNames?.item,
          item.className
        )}>
        <div
          role={isInteractive ? 'button' : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          aria-expanded={canExpand ? isExpanded : undefined}
          aria-controls={canExpand ? contentId : undefined}
          className={cn(
            'group/agent-tool-trigger relative flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-left font-semibold text-foreground/90 text-sm leading-4 outline-none hover:no-underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 hover:[&_.tool-icon>*]:opacity-0',
            item.classNames?.header
          )}
          onClick={isInteractive ? openOrToggle : undefined}
          onKeyDown={handleHeaderKeyDown}>
          {item.label}
          {canExpand && (
            <button
              type="button"
              aria-label={t(isExpanded ? 'button.collapse' : 'code_block.expand')}
              className="-translate-y-1/2 absolute top-1/2 rounded-sm text-foreground-muted opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/agent-tool-trigger:opacity-100"
              style={{ left: 'var(--agent-tool-toggle-left, 0.625rem)' }}
              onClick={(event) => {
                event.stopPropagation()
                toggleExpanded()
              }}>
              {isExpanded ? <Minus size={16} /> : <Plus size={16} />}
            </button>
          )}
        </div>
        {canExpand && (
          <div
            id={contentId}
            data-testid={`collapse-content-${item.key}`}
            hidden={!isExpanded}
            className={cn('mt-2 p-2.5 text-foreground/60 text-sm leading-5', item.classNames?.body)}>
            {item.children}
          </div>
        )}
      </div>
    </StreamingContext>
  )
}
