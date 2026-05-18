import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useNavigate } from '@tanstack/react-router'
import { CircleX, FileSearch, Plus } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
}

const KnowledgeBaseButton: FC<Props> = ({ quickPanel, selectedBases, onSelect, disabled }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const quickPanelHook = useQuickPanel()
  const { knowledgeBases } = useKnowledgeBases()
  const selectedBasesRef = useRef(selectedBases)

  useEffect(() => {
    selectedBasesRef.current = selectedBases
  }, [selectedBases])

  const handleBaseSelect = useCallback(
    (base: KnowledgeBase) => {
      const currentSelectedBases = selectedBasesRef.current

      if (currentSelectedBases?.some((selected) => selected.id === base.id)) {
        onSelect(currentSelectedBases.filter((selected) => selected.id !== base.id))
      } else {
        onSelect([...(currentSelectedBases || []), base])
      }
    },
    [onSelect]
  )

  const baseItems = useMemo<QuickPanelListItem[]>(() => {
    const items: QuickPanelListItem[] = knowledgeBases.map((base) => ({
      label: base.name,
      description: `${base.documentCount ?? 0} ${t('files.count')}`,
      icon: <FileSearch />,
      action: () => handleBaseSelect(base),
      isSelected: selectedBases?.some((selected) => selected.id === base.id)
    }))

    items.push({
      label: t('knowledge.add.title') + '...',
      icon: <Plus />,
      action: () => navigate({ to: '/app/knowledge' }),
      isSelected: false
    })

    items.unshift({
      label: t('settings.input.clear.all'),
      description: t('settings.input.clear.knowledge_base'),
      icon: <CircleX />,
      isSelected: false,
      action: ({ context: ctx }) => {
        onSelect([])
        ctx.close()
      }
    })

    return items
  }, [knowledgeBases, t, selectedBases, handleBaseSelect, navigate, onSelect])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({
      title: t('chat.input.knowledge_base'),
      list: baseItems,
      symbol: QuickPanelReservedSymbol.KnowledgeBase,
      multiple: true,
      afterAction({ item }) {
        item.isSelected = !item.isSelected
      }
    })
  }, [baseItems, quickPanelHook, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.KnowledgeBase) {
      quickPanelHook.close()
    } else {
      openQuickPanel()
    }
  }, [openQuickPanel, quickPanelHook])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([
      {
        label: t('chat.input.knowledge_base'),
        description: '',
        icon: <FileSearch />,
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.KnowledgeBase, () => openQuickPanel())

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [openQuickPanel, quickPanel, t])

  return (
    <Tooltip content={t('chat.input.knowledge_base')}>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={selectedBases && selectedBases.length > 0}
        disabled={disabled}
        aria-label={t('chat.input.knowledge_base')}
        icon={<FileSearch size={18} />}
      />
    </Tooltip>
  )
}

export default memo(KnowledgeBaseButton)
