import { cn } from '@cherrystudio/ui/lib/utils'
import { Bot, Boxes, Braces, Code2, FileText, Globe2, Monitor, Wrench } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'

import type { ComposerDraftToken, ComposerDraftTokenKind } from './tokens'

const tokenIconByKind: Record<ComposerDraftTokenKind, ReactNode> = {
  skill: <Wrench size={14} />,
  file: <FileText size={14} />,
  command: <Code2 size={14} />,
  model: <Bot size={14} />,
  knowledge: <Boxes size={14} />,
  mcpPrompt: <Wrench size={14} />,
  mcpResource: <Globe2 size={14} />,
  reference: <Globe2 size={14} />,
  environment: <Monitor size={14} />,
  promptVariable: <Braces size={14} />
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
  if (token.kind === 'model') {
    return (
      <span
        className={cn('inline-flex h-0 w-0 select-none overflow-hidden align-baseline', className)}
        title={token.label}
        data-composer-token-kind={token.kind}>
        <span className="sr-only">{token.label}</span>
      </span>
    )
  }

  const isPromptVariable = token.kind === 'promptVariable'

  return (
    <span
      className={cn(
        'mx-0.5 inline-flex select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-sm leading-5',
        maxWidthClassName,
        isPromptVariable ? 'border-info/30 bg-info/10 text-info' : 'border-border bg-muted text-foreground shadow-none',
        selected && 'border-primary bg-primary/10 text-primary ring-1 ring-primary/30',
        className
      )}
      title={token.description ?? token.promptText ?? token.label}
      data-composer-token-kind={token.kind}
      onMouseDown={onMouseDown}>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-current">
        {token.icon ? token.icon : tokenIconByKind[token.kind]}
      </span>
      {children ?? <span className="min-w-0 truncate">{token.label}</span>}
    </span>
  )
}
