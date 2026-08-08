import { loggerService } from '@logger'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { useTranslate } from '@renderer/hooks/translate'
import { toast } from '@renderer/services/toast'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { translateComposerDraft } from './composerDraftTranslation'
import type { ComposerSerializedDraft } from './tokens'

const TRIPLE_SPACE_TRANSLATION_WINDOW_MS = 200

interface UseComposerDraftTranslationOptions {
  getDraft: () => ComposerSerializedDraft
  onTranslatedDraft: (draft: ComposerSerializedDraft) => void
  loggerContext: string
  scopeKey: string | undefined
}

export function useComposerDraftTranslation({
  getDraft,
  onTranslatedDraft,
  loggerContext,
  scopeKey
}: UseComposerDraftTranslationOptions) {
  const [autoTranslateWithSpace] = usePreference('chat.input.translate.auto_translate_with_space')
  const [translateTargetLanguage] = usePreference('chat.input.translate.target_language')
  const { t } = useTranslation()
  const { translate, isTranslating, cancel } = useTranslate({ loggerContext })
  const logger = useMemo(() => loggerService.withContext(loggerContext), [loggerContext])
  const spaceKeyCountRef = useRef(0)
  const spaceKeyTimerRef = useRef<number | null>(null)
  const translationTriggerInFlightRef = useRef(false)
  const translationGenerationRef = useRef(0)
  const activeScopeKeyRef = useRef(scopeKey)
  activeScopeKeyRef.current = scopeKey

  const resetTripleSpaceTrigger = useCallback(() => {
    spaceKeyCountRef.current = 0
    if (spaceKeyTimerRef.current !== null) {
      window.clearTimeout(spaceKeyTimerRef.current)
      spaceKeyTimerRef.current = null
    }
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isPlainSpace =
        event.key === ' ' &&
        !event.isComposing &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey

      if (!autoTranslateWithSpace || !isPlainSpace) {
        resetTripleSpaceTrigger()
        return false
      }

      spaceKeyCountRef.current += 1
      if (spaceKeyTimerRef.current !== null) window.clearTimeout(spaceKeyTimerRef.current)
      spaceKeyTimerRef.current = window.setTimeout(() => {
        spaceKeyCountRef.current = 0
        spaceKeyTimerRef.current = null
      }, TRIPLE_SPACE_TRANSLATION_WINDOW_MS)

      if (spaceKeyCountRef.current < 3) return false

      resetTripleSpaceTrigger()
      if (translationTriggerInFlightRef.current) return false

      const triggerScopeKey = scopeKey
      const triggerGeneration = translationGenerationRef.current
      translationTriggerInFlightRef.current = true
      void translateComposerDraft(getDraft(), (sourceText) => translate(sourceText, translateTargetLanguage))
        .then((translatedDraft) => {
          if (
            translatedDraft &&
            activeScopeKeyRef.current === triggerScopeKey &&
            translationGenerationRef.current === triggerGeneration
          ) {
            onTranslatedDraft(translatedDraft)
          }
        })
        .catch((error) => {
          logger.warn('Failed to translate the composer draft', { error })
          toast.error(t('translate.error.failed'))
        })
        .finally(() => {
          translationTriggerInFlightRef.current = false
        })

      return false
    },
    [
      autoTranslateWithSpace,
      getDraft,
      logger,
      onTranslatedDraft,
      resetTripleSpaceTrigger,
      scopeKey,
      t,
      translate,
      translateTargetLanguage
    ]
  )

  useEffect(() => {
    translationGenerationRef.current += 1
    translationTriggerInFlightRef.current = false
    resetTripleSpaceTrigger()
    cancel()
  }, [cancel, resetTripleSpaceTrigger, scopeKey])

  useEffect(() => {
    return () => {
      translationGenerationRef.current += 1
      translationTriggerInFlightRef.current = false
      resetTripleSpaceTrigger()
    }
  }, [resetTripleSpaceTrigger])

  return { isTranslating, onKeyDown }
}
