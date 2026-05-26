import { Tooltip } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { ToolLauncherApi } from '@renderer/components/chat/composer/tools/types'
import PromptEditDialog from '@renderer/components/PromptEditDialog'
import {
  type QuickPanelCallBackOptions,
  type QuickPanelListItem,
  type QuickPanelOpenOptions,
  QuickPanelReservedSymbol,
  type QuickPanelTriggerInfo
} from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useTimer } from '@renderer/hooks/useTimer'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Prompt } from '@shared/data/types/prompt'
import { Plus, Zap } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { computeQuickPhraseInsertResult } from './quickPhraseInsert'

interface Props {
  launcher: ToolLauncherApi
  setInputValue: React.Dispatch<React.SetStateAction<string>>
  resizeTextArea: () => void
}

const logger = loggerService.withContext('QuickPhrasesButton')

const useQuickPhrasesToolController = ({ launcher, setInputValue, resizeTextArea }: Props) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const { t } = useTranslation()
  const {
    close: closeQuickPanel,
    isVisible: isQuickPanelVisible,
    open: openQuickPanelContext,
    symbol: quickPanelSymbol,
    updateList: updateQuickPanelList
  } = useQuickPanel()
  const { setTimeoutTimer } = useTimer()
  const triggerInfoRef = useRef<
    (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string }) | undefined
  >(undefined)

  const { data: promptsRaw, isLoading: isPromptsLoading, error: promptsError } = useQuery('/prompts')

  const { trigger: createPrompt, isLoading: isCreatingPrompt } = useMutation('POST', '/prompts', {
    refresh: ['/prompts'],
    onError: (error) => {
      logger.error('Failed to create prompt', error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('settings.prompts.errors.createFailed')))
    }
  })

  const promptItems = useMemo(() => promptsRaw || [], [promptsRaw])

  const insertText = useCallback(
    (text: string, options?: QuickPanelCallBackOptions) => {
      const inputAdapter = options?.inputAdapter
      if (inputAdapter) {
        const triggerInfo = triggerInfoRef.current
        if (triggerInfo?.type === 'input' && triggerInfo.position !== undefined) {
          const to =
            inputAdapter.getCursorOffset?.() ?? triggerInfo.position + 1 + (triggerInfo.searchText?.length ?? 0)
          inputAdapter.deleteTriggerRange({ from: triggerInfo.position, to })
        }
        inputAdapter.insertText(text)
        inputAdapter.focus()
        triggerInfoRef.current = undefined
        return
      }

      setTimeoutTimer(
        'handlePhraseSelect_1',
        () => {
          setInputValue((prev) => {
            const triggerInfo = triggerInfoRef.current

            const result = computeQuickPhraseInsertResult({
              currentValue: prev,
              insertText: text,
              rootSymbol: QuickPanelReservedSymbol.Root,
              triggerInfo,
              selectionStart: prev.length,
              selectionEnd: prev.length
            })
            triggerInfoRef.current = undefined

            setTimeoutTimer(
              'handlePhraseSelect_2',
              () => {
                resizeTextArea()
              },
              10
            )
            return result.value
          })
        },
        10
      )
    },
    [setTimeoutTimer, setInputValue, resizeTextArea]
  )

  const handleItemSelect = useCallback(
    (item: Prompt, options?: QuickPanelCallBackOptions) => {
      insertText(item.content, options)
    },
    [insertText]
  )

  const handleAddModalSave = useCallback(
    async (data: { title: string; content: string }) => {
      try {
        await createPrompt({
          body: {
            title: data.title,
            content: data.content
          }
        })
        setIsAddModalOpen(false)
      } catch {
        // handled by useMutation onError
      }
    },
    [createPrompt]
  )

  const phraseItems = useMemo(() => {
    const newList: QuickPanelListItem[] = []

    if (isPromptsLoading && promptItems.length === 0) {
      newList.push({
        label: t('common.loading'),
        icon: <Zap />,
        disabled: true
      })
    } else if (promptsError && promptItems.length === 0) {
      newList.push({
        label: formatErrorMessageWithPrefix(promptsError, t('settings.prompts.errors.loadFailed')),
        icon: <Zap />,
        disabled: true
      })
    } else {
      newList.push(
        ...promptItems.map((item) => ({
          label: item.title,
          description: item.content,
          icon: <Zap />,
          action: (options) => handleItemSelect(item, options)
        }))
      )
    }

    newList.push({
      label: t('settings.prompts.add') + '...',
      icon: <Plus />,
      action: () => setIsAddModalOpen(true)
    })

    return newList
  }, [handleItemSelect, isPromptsLoading, promptItems, promptsError, t])

  const quickPanelOpenOptions = useMemo<QuickPanelOpenOptions>(
    () => ({
      title: t('settings.prompts.title'),
      list: phraseItems,
      symbol: QuickPanelReservedSymbol.QuickPhrases
    }),
    [phraseItems, t]
  )

  const quickPanelOpenOptionsRef = useRef(quickPanelOpenOptions)

  useEffect(() => {
    quickPanelOpenOptionsRef.current = quickPanelOpenOptions
  }, [quickPanelOpenOptions])

  useEffect(() => {
    if (isQuickPanelVisible && quickPanelSymbol === QuickPanelReservedSymbol.QuickPhrases) {
      updateQuickPanelList(phraseItems)
    }
  }, [isQuickPanelVisible, phraseItems, quickPanelSymbol, updateQuickPanelList])

  type QuickPhraseTrigger =
    | (QuickPanelTriggerInfo & { symbol?: QuickPanelReservedSymbol; searchText?: string })
    | undefined

  const openQuickPanel = useCallback(
    (triggerInfo?: QuickPhraseTrigger) => {
      triggerInfoRef.current = triggerInfo
      openQuickPanelContext({
        ...quickPanelOpenOptionsRef.current,
        triggerInfo:
          triggerInfo && triggerInfo.type === 'input'
            ? {
                type: triggerInfo.type,
                position: triggerInfo.position,
                originalText: triggerInfo.originalText
              }
            : triggerInfo,
        onClose: () => {
          triggerInfoRef.current = undefined
        }
      })
    },
    [openQuickPanelContext]
  )

  const handleOpenQuickPanel = useCallback(() => {
    if (isQuickPanelVisible && quickPanelSymbol === QuickPanelReservedSymbol.QuickPhrases) {
      closeQuickPanel()
    } else {
      openQuickPanel()
    }
  }, [closeQuickPanel, isQuickPanelVisible, openQuickPanel, quickPanelSymbol])

  useEffect(() => {
    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'quick-phrases',
        kind: 'panel',
        sources: ['root-panel'],
        order: 70,
        label: t('settings.prompts.title'),
        description: '',
        icon: <Zap />,
        action: ({ quickPanel: context, searchText }) => {
          const rootTrigger =
            context.triggerInfo && context.triggerInfo.type === 'input'
              ? {
                  ...context.triggerInfo,
                  symbol: QuickPanelReservedSymbol.Root,
                  searchText: searchText ?? ''
                }
              : undefined

          context.close('select')
          setTimeoutTimer('openQuickPhrasesRootMenu', () => openQuickPanel(rootTrigger), 0)
        }
      }
    ])

    return () => {
      disposeLauncher()
    }
  }, [launcher, openQuickPanel, setTimeoutTimer, t])

  return {
    handleAddModalSave,
    handleOpenQuickPanel,
    isAddModalOpen,
    isCreatingPrompt,
    setIsAddModalOpen,
    t
  }
}

const QuickPhrasesModal = ({
  handleAddModalSave,
  isAddModalOpen,
  isCreatingPrompt,
  setIsAddModalOpen
}: Pick<
  ReturnType<typeof useQuickPhrasesToolController>,
  'handleAddModalSave' | 'isAddModalOpen' | 'isCreatingPrompt' | 'setIsAddModalOpen'
>) => (
  <PromptEditDialog
    open={isAddModalOpen}
    saving={isCreatingPrompt}
    onSave={handleAddModalSave}
    onCancel={() => setIsAddModalOpen(false)}
  />
)

export const QuickPhrasesToolRuntime = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  return <QuickPhrasesModal {...controller} />
}

const QuickPhrasesButton = (props: Props) => {
  const controller = useQuickPhrasesToolController(props)
  const { handleOpenQuickPanel, t } = controller

  return (
    <>
      <Tooltip content={t('settings.prompts.title')}>
        <ActionIconButton
          onClick={handleOpenQuickPanel}
          aria-label={t('settings.prompts.title')}
          icon={<Zap size={18} />}
        />
      </Tooltip>

      <QuickPhrasesModal {...controller} />
    </>
  )
}

export default memo(QuickPhrasesButton)
