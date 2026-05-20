import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { FileSearch } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  launcher: ToolLauncherApi
  configuredKnowledgeBaseIds?: string[]
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
}

const useKnowledgeBaseToolController = ({
  launcher,
  configuredKnowledgeBaseIds,
  selectedBases,
  onSelect,
  disabled
}: Props) => {
  const { t } = useTranslation()
  const { knowledgeBases } = useKnowledgeBases()

  const configuredBases = useMemo(() => {
    const configuredIds = new Set(configuredKnowledgeBaseIds ?? [])
    if (configuredIds.size === 0) return []
    return knowledgeBases.filter((base) => configuredIds.has(base.id))
  }, [configuredKnowledgeBaseIds, knowledgeBases])

  const isEnabled = (selectedBases?.length ?? 0) > 0
  const isDisabled = disabled || configuredBases.length === 0

  const handleToggle = useCallback(() => {
    if (isDisabled) return
    onSelect(isEnabled ? [] : configuredBases)
  }, [configuredBases, isDisabled, isEnabled, onSelect])

  useEffect(() => {
    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'knowledge-base',
        kind: 'command',
        sources: ['popover', 'root-panel'],
        order: 40,
        label: t('chat.input.knowledge_base'),
        description: '',
        icon: <FileSearch />,
        active: isEnabled,
        disabled: isDisabled,
        suffix: isEnabled ? t('common.enabled') : undefined,
        action: handleToggle
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [handleToggle, isDisabled, isEnabled, launcher, t])

  return { disabled: isDisabled, handleToggle, isEnabled, t }
}

export const KnowledgeBaseToolRuntime: FC<Props> = (props) => {
  useKnowledgeBaseToolController(props)
  return null
}

const KnowledgeBaseButton: FC<Props> = (props) => {
  const { disabled, handleToggle, isEnabled, t } = useKnowledgeBaseToolController(props)

  return (
    <Tooltip content={t('chat.input.knowledge_base')}>
      <ActionIconButton
        onClick={handleToggle}
        active={isEnabled}
        disabled={disabled}
        aria-label={t('chat.input.knowledge_base')}
        icon={<FileSearch size={18} />}
      />
    </Tooltip>
  )
}

export default memo(KnowledgeBaseButton)
