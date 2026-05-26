import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import PromptEditorField from '@renderer/components/PromptEditorField'
import { usePromptProcessor } from '@renderer/hooks/usePromptProcessor'
import { fetchGenerate } from '@renderer/services/ApiService'
import { AGENT_PROMPT } from '@shared/config/prompts'
import type { Assistant } from '@shared/data/types/assistant'
import { Loader2, Sparkles, Undo2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FieldHeader } from '../../FieldHeader'
import { PromptVariablesTooltip } from '../../PromptVariablesTooltip'

interface Props {
  assistant?: Pick<Assistant, 'modelName'> | null
  assistantName?: string
  prompt: string
  promptError?: string
  hideHeader?: boolean
  onChange: (prompt: string) => void
}

const logger = loggerService.withContext('LibraryAssistantPromptSection')

/**
 * Prompt editor — writes the top-level `prompt` column on the assistant.
 *
 * Feature parity with the legacy `AssistantPromptSettings` *prompt* half
 * (name / emoji live in BasicSection in v2). Keeps CodeEditor (markdown) /
 * Streamdown preview toggle, 8-variable tooltip, Token count, and
 * double-click-preview-to-edit. Save cadence is the v2 top-bar global PATCH,
 * not the legacy's per-field instant save.
 *
 * TODO(v2-llm-migration): `usePromptProcessor` → `replacePromptVariables`
 * transitively reads Redux (`store.getState().llm.defaultModel?.name` fallback
 * when `assistant.modelName` is null) and legacy IPC
 * (`window.api.system.getDeviceType()` / `window.api.getAppInfo().arch` for
 * {{system}} / {{arch}}). Same Redux / legacy-IPC cluster as BasicSection's
 * ModelAvatar / SelectChatModelPopup / useProviders — should land together in
 * the same follow-up PR. Kept here so the editor matches legacy UX.
 */
const PromptSection: FC<Props> = ({ assistant, assistantName, prompt, promptError, hideHeader = false, onChange }) => {
  const { t } = useTranslation()
  const [generating, setGenerating] = useState(false)
  const [showUndoButton, setShowUndoButton] = useState(false)
  const [originalPrompt, setOriginalPrompt] = useState('')
  const [resetPreviewKey, setResetPreviewKey] = useState(0)
  const generateSource = prompt.trim() || assistantName?.trim() || ''

  const processedPrompt = usePromptProcessor({
    prompt,
    modelName: assistant?.modelName ?? undefined
  })

  const handlePromptChange = (nextPrompt: string) => {
    setShowUndoButton(false)
    onChange(nextPrompt)
  }

  const handleGeneratePrompt = async () => {
    if (!generateSource || generating) return

    setGenerating(true)
    setShowUndoButton(false)

    try {
      const generatedPrompt = await fetchGenerate({
        prompt: AGENT_PROMPT,
        content: generateSource
      })

      if (!generatedPrompt) return

      setOriginalPrompt(prompt)
      onChange(generatedPrompt)
      setShowUndoButton(true)
      setResetPreviewKey((key) => key + 1)
    } catch (error) {
      logger.error('Failed to generate assistant prompt', error as Error)
    } finally {
      setGenerating(false)
    }
  }

  const handleUndoGeneratedPrompt = () => {
    onChange(originalPrompt)
    setShowUndoButton(false)
    setResetPreviewKey((key) => key + 1)
  }

  const promptActions = (
    <>
      {showUndoButton && (
        <Tooltip content={t('common.undo')}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('common.undo')}
            onClick={handleUndoGeneratedPrompt}
            className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0">
            <Undo2 size={10} />
          </Button>
        </Tooltip>
      )}
      <Tooltip content={t('library.config.prompt.generate')}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('library.config.prompt.generate')}
          onClick={handleGeneratePrompt}
          disabled={!generateSource || generating}
          className="flex h-6 min-h-0 w-6 items-center justify-center rounded-2xs border border-border/20 p-0 text-muted-foreground/80 shadow-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
          {generating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
        </Button>
      </Tooltip>
    </>
  )

  return (
    <div className={hideHeader ? 'mt-6 space-y-6' : 'space-y-6'}>
      {!hideHeader && (
        <div>
          <h3 className="mb-1 text-base text-foreground">{t('library.config.prompt.title')}</h3>
          <p className="text-muted-foreground/80 text-xs">{t('library.config.prompt.desc')}</p>
        </div>
      )}

      <PromptEditorField
        label={<FieldHeader label={t('library.config.prompt.label')} className="min-w-0" />}
        labelAddon={<PromptVariablesTooltip />}
        value={prompt}
        onChange={handlePromptChange}
        placeholder={t('library.config.prompt.placeholder')}
        error={promptError}
        previewValue={processedPrompt || prompt}
        resetPreviewKey={resetPreviewKey}
        actions={promptActions}
      />
    </div>
  )
}

export default PromptSection
