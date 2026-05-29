import { NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  getQuoteTooltipContent,
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/chat/utils/quoteToken'
import { Boxes, Braces, FileText, TextQuote, Zap } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'

import type { ActiveComposerInputTokenKind, ComposerDraftToken } from './tokens'
import { isActiveComposerInputTokenKind } from './tokens'

const tokenIconClassName = 'size-[1em] shrink-0 text-current opacity-80'

const tokenIconByKind: Record<ActiveComposerInputTokenKind, ReactNode> = {
  skill: <Zap className={tokenIconClassName} />,
  file: <FileText className={tokenIconClassName} />,
  knowledge: <Boxes className={tokenIconClassName} />,
  quote: <TextQuote className={tokenIconClassName} />,
  promptVariable: <Braces className={tokenIconClassName} />
}

export interface ComposerTokenProps {
  token: ComposerDraftToken
  selected?: boolean
  className?: string
  children?: ReactNode
  maxWidthClassName?: string
  onMouseDown?: MouseEventHandler<HTMLSpanElement>
}

export function ComposerToken({
  token,
  selected = false,
  className,
  children,
  maxWidthClassName = 'max-w-52',
  onMouseDown
}: ComposerTokenProps) {
  if (!isActiveComposerInputTokenKind(token.kind)) {
    const title = token.description ?? token.promptText ?? token.label
    return (
      <span
        className={cn(
          'mx-0.5 inline-flex select-none align-baseline text-muted-foreground leading-[inherit]',
          maxWidthClassName,
          selected && 'underline decoration-muted-foreground/40 underline-offset-2',
          className
        )}
        title={title}
        data-composer-token-kind={token.kind}
        data-composer-token-legacy="">
        {children ?? <span className="min-w-0 truncate">{token.label}</span>}
      </span>
    )
  }

  const isPromptVariable = token.kind === 'promptVariable'
  const quoteTooltipContent =
    token.kind === 'quote' ? getQuoteTooltipContent(token.description, token.promptText) : undefined
  const title = token.kind === 'quote' ? undefined : (token.description ?? token.promptText ?? token.label)

  const tokenElement = (
    <span
      className={cn(
        'mx-0.5 inline-flex select-none items-baseline gap-1 align-baseline leading-[inherit]',
        maxWidthClassName,
        isPromptVariable ? 'text-info' : 'text-primary',
        selected && 'text-primary underline decoration-primary/40 underline-offset-2',
        className
      )}
      title={title}
      data-composer-token-kind={token.kind}
      onMouseDown={onMouseDown}>
      <span className="inline-flex shrink-0 translate-y-[0.08em] items-baseline text-current leading-[inherit]">
        {token.icon ? token.icon : tokenIconByKind[token.kind]}
      </span>
      {children ?? <span className="min-w-0 truncate">{token.label}</span>}
    </span>
  )

  if (!quoteTooltipContent) return tokenElement

  return (
    <NormalTooltip
      content={<div className={QUOTE_TOOLTIP_BODY_CLASS_NAME}>{quoteTooltipContent}</div>}
      side="top"
      sideOffset={6}
      delayDuration={300}
      contentProps={{ className: QUOTE_TOOLTIP_CONTENT_CLASS_NAME }}>
      {tokenElement}
    </NormalTooltip>
  )
}
