import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { renderAsync } from 'docx-preview'
import type { TFunction } from 'i18next'
import { AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('WordPreviewPanel')

export interface WordPreviewPanelProps {
  fileName?: string
  filePath: string
  refreshKey?: number
}

type WordPreviewStatus =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'error'; code: 'parse_failed' | 'read_failed'; detail?: string }

const WORD_PREVIEW_ERROR_KEYS: Record<Extract<WordPreviewStatus, { type: 'error' }>['code'], string> = {
  parse_failed: 'agent.preview_pane.word.errors.parse_failed',
  read_failed: 'agent.preview_pane.word.errors.read_failed'
}

const getWordPreviewErrorDescription = (
  t: TFunction,
  code: Extract<WordPreviewStatus, { type: 'error' }>['code'],
  detail?: string
): string => {
  return t(WORD_PREVIEW_ERROR_KEYS[code], { defaultValue: detail ?? t('common.error') })
}

const toWordData = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return data as Uint8Array
}

const WordPreviewPanel = ({ filePath, fileName, refreshKey = 0 }: WordPreviewPanelProps) => {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<WordPreviewStatus>({ type: 'loading' })

  useEffect(() => {
    let cancelled = false
    const bodyContainer = bodyRef.current
    const styleContainer = styleRef.current

    if (!bodyContainer || !styleContainer) return

    bodyContainer.replaceChildren()
    styleContainer.replaceChildren()
    setStatus({ type: 'loading' })

    void (async () => {
      try {
        const data = toWordData(await window.api.fs.read(filePath))
        if (cancelled) return

        try {
          await renderAsync(data, bodyContainer, styleContainer, {
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            inWrapper: true,
            renderAltChunks: false,
            renderComments: false,
            renderEndnotes: true,
            renderFooters: true,
            renderFootnotes: true,
            renderHeaders: true,
            useBase64URL: true
          })
        } catch (renderError) {
          if (cancelled) return

          const normalized = renderError instanceof Error ? renderError : new Error(String(renderError))
          logger.error(`Failed to render Word preview: ${filePath}`, normalized)
          bodyContainer.replaceChildren()
          styleContainer.replaceChildren()
          setStatus({ type: 'error', code: 'parse_failed', detail: normalized.message })
          return
        }

        if (cancelled) {
          bodyContainer.replaceChildren()
          styleContainer.replaceChildren()
          return
        }

        setStatus({ type: 'ready' })
      } catch (err) {
        if (cancelled) return

        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to load Word preview: ${filePath}`, normalized)
        bodyContainer.replaceChildren()
        styleContainer.replaceChildren()
        setStatus({ type: 'error', code: 'read_failed', detail: normalized.message })
      }
    })()

    return () => {
      cancelled = true
      bodyContainer.replaceChildren()
      styleContainer.replaceChildren()
    }
  }, [filePath, refreshKey])

  return (
    <div className="relative h-full w-full overflow-auto bg-background">
      <div
        aria-label={fileName ?? filePath}
        className="mx-auto min-h-full w-fit px-4 py-6 [&_.docx-wrapper>section.docx]:mb-4 [&_.docx-wrapper>section.docx]:shadow-md [&_.docx-wrapper]:bg-background [&_.docx-wrapper]:p-0"
        data-testid="word-preview-document">
        <div ref={styleRef} data-testid="word-preview-styles" />
        <div ref={bodyRef} />
      </div>

      {status.type === 'loading' && (
        <div className="absolute inset-0 flex h-full w-full items-center justify-center bg-background">
          <LoadingState label={t('common.loading')} />
        </div>
      )}

      {status.type === 'error' && (
        <div className="absolute inset-0 h-full w-full bg-background">
          <EmptyState
            icon={AlertCircle}
            title={t('common.error')}
            description={getWordPreviewErrorDescription(t, status.code, status.detail)}
          />
        </div>
      )}
    </div>
  )
}

export default WordPreviewPanel
