import { cn } from '@cherrystudio/ui/lib/utils'
import { Bot, Boxes, Code2, FileText, Globe2, Monitor, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ComposerDraftToken, ComposerDraftTokenKind } from './tokens'

const tokenIconByKind: Record<ComposerDraftTokenKind, ReactNode> = {
  skill: <Wrench size={14} />,
  file: <FileText size={14} />,
  command: <Code2 size={14} />,
  model: <Bot size={14} />,
  knowledge: <Boxes size={14} />,
  reference: <Globe2 size={14} />,
  environment: <Monitor size={14} />
}

export interface ComposerTokenProps {
  token: ComposerDraftToken
  selected?: boolean
  className?: string
}

export function ComposerToken({ token, selected = false, className }: ComposerTokenProps) {
  return (
    <span
      className={cn(
        'mx-0.5 inline-flex max-w-52 select-none items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-sm leading-5',
        'border-border bg-muted text-foreground shadow-none',
        selected && 'border-primary bg-primary/10 text-primary',
        className
      )}
      data-composer-token-kind={token.kind}>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-current">
        {token.icon ? token.icon : tokenIconByKind[token.kind]}
      </span>
      <span className="min-w-0 truncate">{token.label}</span>
    </span>
  )
}
