import { formatQuoteTokenPromptText } from '@renderer/components/composer/quoteToken'
import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComposerDraftToken } from '../../tokens'

export const createQuoteToken = (selectedText: string, label: string): ComposerDraftToken => ({
  id: `quote:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  kind: 'quote',
  label,
  description: selectedText,
  promptText: formatQuoteTokenPromptText(selectedText)
})

interface QuoteInsertionActions {
  insertToken: (token: ComposerDraftToken) => boolean
}

/**
 * Inserts a selection quote routed to this composer by the owning chat page.
 */
export function useComposerQuoteInsertion<T extends QuoteInsertionActions>(
  actionsRef: RefObject<T>,
  selectedText?: string,
  onInserted?: () => void
): void {
  const { t } = useTranslation()
  const insertedTextRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!selectedText) {
      insertedTextRef.current = undefined
      return
    }
    if (insertedTextRef.current === selectedText) return
    const token = createQuoteToken(selectedText, t('selection.action.builtin.quote'))
    if (!actionsRef.current.insertToken(token)) return

    insertedTextRef.current = selectedText
    onInserted?.()
  }, [actionsRef, onInserted, selectedText, t])
}
