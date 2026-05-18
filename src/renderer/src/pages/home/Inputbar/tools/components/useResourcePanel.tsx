import { Icon } from '@iconify/react'
import { loggerService } from '@logger'
import type { ComposerDraftToken } from '@renderer/components/chat/composer'
import type {
  QuickPanelCallBackOptions,
  QuickPanelInputAdapter,
  QuickPanelListItem
} from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { useInstalledSkills } from '@renderer/hooks/useSkills'
import type { ToolLauncherApi, ToolQuickPanelApi, ToolQuickPanelController } from '@renderer/pages/home/Inputbar/types'
import { FILE_TYPE, type FileMetadata } from '@renderer/types'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { getFileTypeByExt } from '@shared/file/types'
import type { InstalledSkill } from '@types'
import { Folder, Zap } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useResourcePanel')
const MAX_FILE_RESULTS = 500
const MAX_SEARCH_RESULTS = 20

const getBaseName = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

const getFileExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex > 0 ? fileName.slice(lastDotIndex) : ''
}

const createFileMetadataFromPath = (filePath: string): FileMetadata => {
  const name = getBaseName(filePath)
  const ext = getFileExtension(name)
  return {
    id: filePath,
    name,
    origin_name: name,
    path: filePath,
    size: 0,
    ext,
    type: ext ? getFileTypeByExt(ext) : FILE_TYPE.OTHER,
    created_at: new Date().toISOString(),
    count: 1
  }
}

const createFileToken = (file: FileMetadata): ComposerDraftToken => ({
  id: `file:${file.id || file.path}`,
  kind: 'file',
  label: file.origin_name || file.name,
  payload: file
})

const createSkillToken = (skill: InstalledSkill): ComposerDraftToken => ({
  id: `skill:${skill.folderName || skill.name}`,
  kind: 'skill',
  label: skill.name,
  description: skill.description || undefined,
  payload: {
    skillId: skill.folderName || skill.name,
    name: skill.name,
    folderName: skill.folderName,
    description: skill.description
  }
})

const deleteActiveTriggerText = (inputAdapter: QuickPanelInputAdapter, searchText?: string) => {
  if (!searchText) return
  inputAdapter.deleteTriggerRange({ from: 0, to: searchText.length })
}

const areFileListsEqual = (prev: string[], next: string[]) => {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let index = 0; index < prev.length; index++) {
    if (prev[index] !== next[index]) return false
  }
  return true
}

export type ResourcePanelTriggerInfo = {
  type: 'input' | 'button'
  position?: number
  originalText?: string
  symbol?: QuickPanelReservedSymbol
}

interface Params {
  quickPanel: ToolQuickPanelApi
  launcher: ToolLauncherApi
  quickPanelController: ToolQuickPanelController
  accessiblePaths: string[]
  agentId?: string
  files: FileMetadata[]
  setFiles: React.Dispatch<React.SetStateAction<FileMetadata[]>>
  setText: React.Dispatch<React.SetStateAction<string>>
}

export const useResourcePanel = (params: Params, role: 'button' | 'manager' = 'button') => {
  const { quickPanel, launcher, quickPanelController, accessiblePaths, agentId, files, setFiles, setText } = params
  const { registerTrigger } = quickPanel
  const { open, close, updateList, isVisible, symbol } = quickPanelController
  const { t } = useTranslation()

  const { skills: enabledSkills, loading: skillsLoading } = useInstalledSkills(agentId)

  const [fileList, setFileList] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const triggerInfoRef = useRef<ResourcePanelTriggerInfo | undefined>(undefined)
  const hasAttemptedLoadRef = useRef(false)
  const fileListRef = useRef<string[]>([])

  const updateFileListState = useCallback(
    (nextFiles: string[]) => {
      if (areFileListsEqual(fileListRef.current, nextFiles)) {
        return false
      }
      fileListRef.current = nextFiles
      setFileList(nextFiles)
      return true
    },
    [setFileList]
  )

  /**
   * Convert absolute file path to relative path based on accessible directories
   */
  const getRelativePath = useCallback(
    (absolutePath: string): string => {
      const normalizedAbsPath = absolutePath.replace(/\\/g, '/')

      // Find the matching accessible path
      for (const basePath of accessiblePaths) {
        const normalizedBasePath = basePath.replace(/\\/g, '/')
        const baseWithSlash = normalizedBasePath.endsWith('/') ? normalizedBasePath : normalizedBasePath + '/'

        if (normalizedAbsPath.startsWith(baseWithSlash)) {
          return normalizedAbsPath.slice(baseWithSlash.length)
        }
        if (normalizedAbsPath === normalizedBasePath) {
          return ''
        }
      }

      // If no match found, return the original path
      return absolutePath
    },
    [accessiblePaths]
  )

  /**
   * Remove trigger symbol (e.g., @ or /) and search text from input
   */
  const removeTriggerSymbolAndText = useCallback(
    (
      currentText: string,
      caretPosition: number,
      symbol: QuickPanelReservedSymbol,
      searchText?: string,
      fallbackPosition?: number
    ) => {
      const safeCaret = Math.max(0, Math.min(caretPosition ?? 0, currentText.length))

      if (searchText !== undefined) {
        const pattern = symbol + searchText
        const fromIndex = Math.max(0, safeCaret - 1)
        const start = currentText.lastIndexOf(pattern, fromIndex)
        if (start !== -1) {
          const end = start + pattern.length
          return currentText.slice(0, start) + currentText.slice(end)
        }

        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === symbol) {
          const expected = pattern
          const actual = currentText.slice(fallbackPosition, fallbackPosition + expected.length)
          if (actual === expected) {
            return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + expected.length)
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(fallbackPosition + 1)
        }

        return currentText
      }

      const fromIndex = Math.max(0, safeCaret - 1)
      const start = currentText.lastIndexOf(symbol, fromIndex)
      if (start === -1) {
        if (typeof fallbackPosition === 'number' && currentText[fallbackPosition] === symbol) {
          let endPos = fallbackPosition + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, fallbackPosition) + currentText.slice(endPos)
        }
        return currentText
      }

      let endPos = start + 1
      while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
        endPos++
      }
      return currentText.slice(0, start) + currentText.slice(endPos)
    },
    []
  )

  /**
   * Insert file path at @ position
   */
  const insertFilePath = useCallback(
    (filePath: string, triggerInfo?: ResourcePanelTriggerInfo) => {
      const relativePath = getRelativePath(filePath)
      setText((currentText) => {
        const symbol = triggerInfo?.symbol ?? QuickPanelReservedSymbol.MentionModels
        const triggerIndex =
          triggerInfo?.position !== undefined
            ? triggerInfo.position
            : symbol === QuickPanelReservedSymbol.Root
              ? currentText.lastIndexOf('/')
              : currentText.lastIndexOf('@')

        if (triggerIndex !== -1) {
          let endPos = triggerIndex + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, triggerIndex) + relativePath + ' ' + currentText.slice(endPos)
        }

        // If no trigger found, append at end
        return currentText + ' ' + relativePath + ' '
      })
    },
    [getRelativePath, setText]
  )

  /**
   * Load files from accessible directories
   */
  const loadFiles = useCallback(
    async (searchPattern: string = '.') => {
      if (accessiblePaths.length === 0) {
        logger.warn('No accessible paths configured')
        return []
      }

      hasAttemptedLoadRef.current = true
      setIsLoading(true)
      const deduped = new Set<string>()
      const collected: string[] = []

      try {
        for (const dirPath of accessiblePaths) {
          if (collected.length >= MAX_FILE_RESULTS) {
            break
          }
          if (!dirPath) continue
          try {
            const files = await window.api.file.listDirectory(dirPath, {
              recursive: true,
              maxDepth: 10,
              includeHidden: false,
              includeFiles: true,
              includeDirectories: true,
              maxEntries: MAX_SEARCH_RESULTS,
              searchPattern: searchPattern || '.'
            })

            for (const filePath of files) {
              const normalizedPath = filePath.replace(/\\/g, '/')
              if (deduped.has(normalizedPath)) continue
              deduped.add(normalizedPath)
              collected.push(normalizedPath)
              if (collected.length >= MAX_FILE_RESULTS) {
                break
              }
            }
          } catch (error) {
            logger.warn(`Failed to list directory: ${dirPath}`, error as Error)
          }
        }

        return collected
      } catch (error) {
        logger.error('Failed to load files', error as Error)
        return []
      } finally {
        setIsLoading(false)
      }
    },
    [accessiblePaths]
  )

  /**
   * Handle file selection
   */
  const onSelectFile = useCallback(
    (filePath: string, options?: QuickPanelCallBackOptions) => {
      const trigger = triggerInfoRef.current
      const selectedFile = files.find((file) => file.path === filePath || file.id === filePath)
      const inputAdapter = options?.inputAdapter

      if (inputAdapter?.insertToken) {
        const file = selectedFile ?? createFileMetadataFromPath(filePath)
        const token = createFileToken(file)

        if (selectedFile) {
          setFiles((prevFiles) =>
            prevFiles.filter((currentFile) => currentFile.path !== filePath && currentFile.id !== filePath)
          )
        } else {
          deleteActiveTriggerText(inputAdapter, options?.searchText)
          inputAdapter.insertToken(token)
          setFiles((prevFiles) => [...prevFiles, file])
        }

        inputAdapter.focus()
        close()
        return
      }

      insertFilePath(filePath, trigger)
      close()
    },
    [close, files, insertFilePath, setFiles]
  )

  /**
   * Insert text at @ position (for skills)
   */
  const insertText = useCallback(
    (text: string, triggerInfo?: ResourcePanelTriggerInfo) => {
      setText((currentText) => {
        const symbolChar = triggerInfo?.symbol ?? QuickPanelReservedSymbol.MentionModels
        const triggerIndex =
          triggerInfo?.position !== undefined
            ? triggerInfo.position
            : symbolChar === QuickPanelReservedSymbol.Root
              ? currentText.lastIndexOf('/')
              : currentText.lastIndexOf('@')

        if (triggerIndex !== -1) {
          let endPos = triggerIndex + 1
          while (endPos < currentText.length && !/\s/.test(currentText[endPos])) {
            endPos++
          }
          return currentText.slice(0, triggerIndex) + text + ' ' + currentText.slice(endPos)
        }
        return currentText + ' ' + text + ' '
      })
    },
    [setText]
  )

  /**
   * Handle skill selection
   */
  const onSelectSkill = useCallback(
    (skill: InstalledSkill, options?: QuickPanelCallBackOptions) => {
      const trigger = triggerInfoRef.current
      const inputAdapter = options?.inputAdapter

      if (inputAdapter?.insertToken) {
        deleteActiveTriggerText(inputAdapter, options?.searchText)
        inputAdapter.insertToken(createSkillToken(skill))
        inputAdapter.focus()
        close()
        return
      }

      insertText(skill.name, trigger)
      close()
    },
    [close, insertText]
  )

  /**
   * Create file list items for QuickPanel
   */
  const createFileItems = useCallback(
    (sourceFiles: string[]): QuickPanelListItem[] => {
      return sourceFiles.map((filePath) => {
        const relativePath = getRelativePath(filePath)
        const fileName = relativePath.split('/').pop() || relativePath

        // Include both absolute path and relative path in filterText to improve matching
        const filterText = `${fileName} ${relativePath} ${filePath}`

        return {
          label: relativePath,
          icon: <Icon icon={`material-icon-theme:${getFileIconName(filePath)}`} style={{ fontSize: 16 }} />,
          filterText: filterText,
          action: (options) => onSelectFile(filePath, options),
          isSelected: files.some((file) => file.path === filePath || file.id === filePath)
        }
      })
    },
    [files, getRelativePath, onSelectFile]
  )

  /**
   * Create skill list items for QuickPanel
   */
  const createSkillItems = useCallback(
    (skillList: InstalledSkill[]): QuickPanelListItem[] => {
      return skillList.map((skill) => ({
        label: skill.name,
        description: skill.description || '',
        icon: <Zap size={16} />,
        filterText: `${skill.name} ${skill.description || ''} ${skill.folderName}`,
        action: (options) => onSelectSkill(skill, options),
        isSelected: false
      }))
    },
    [onSelectSkill]
  )

  /**
   * Filter skills by search text
   */
  const filterSkills = useCallback((skillList: InstalledSkill[], searchText: string): InstalledSkill[] => {
    if (!searchText.trim()) return skillList
    const lowerSearch = searchText.toLowerCase()
    return skillList.filter((skill) => {
      const name = skill.name.toLowerCase()
      const desc = (skill.description || '').toLowerCase()
      return name.includes(lowerSearch) || desc.includes(lowerSearch)
    })
  }, [])

  /**
   * Build categorized list with files and skills
   */
  const buildCategorizedList = useCallback(
    (files: string[], skillList: InstalledSkill[], loading: boolean): QuickPanelListItem[] => {
      if (loading && files.length === 0 && skillList.length === 0) {
        return [
          {
            label: t('common.loading'),
            description: t('chat.input.resource_panel.loading'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      const items: QuickPanelListItem[] = []

      // Add Files
      if (files.length > 0) {
        items.push({
          label: t('chat.input.resource_panel.categories.files'),
          description: `(${files.length})`,
          icon: <Folder size={16} />,
          disabled: true,
          action: () => {}
        })
        items.push(...createFileItems(files))
      }

      // Add Skills
      if (skillList.length > 0) {
        items.push({
          label: t('chat.input.resource_panel.categories.skills'),
          description: `(${skillList.length})`,
          icon: <Zap size={16} />,
          disabled: true,
          action: () => {}
        })
        items.push(...createSkillItems(skillList))
      }

      if (items.length === 0) {
        return [
          {
            label: t('chat.input.resource_panel.no_items_found.label'),
            description: t('chat.input.resource_panel.no_items_found.description'),
            icon: <Folder size={16} />,
            action: () => {},
            isSelected: false,
            alwaysVisible: true
          }
        ]
      }

      return items
    },
    [createFileItems, createSkillItems, t]
  )

  /**
   * Current list items for QuickPanel
   */
  const categorizedItems = useMemo<QuickPanelListItem[]>(
    () => buildCategorizedList(fileList, enabledSkills, isLoading || skillsLoading),
    [buildCategorizedList, fileList, enabledSkills, isLoading, skillsLoading]
  )

  /**
   * Handle search text change - load files and update list
   */
  const handleSearchChange = useCallback(
    async (searchText: string) => {
      logger.debug('Search text changed', { searchText })

      const searchPattern = searchText.trim() || '.'
      const newFiles = await loadFiles(searchPattern)

      updateFileListState(newFiles)

      const filteredSkills = filterSkills(enabledSkills, searchText)
      const newItems = buildCategorizedList(newFiles, filteredSkills, false)
      updateList(newItems)
    },
    [loadFiles, enabledSkills, filterSkills, buildCategorizedList, updateList, updateFileListState]
  )

  /**
   * Open QuickPanel with file list
   */
  const openQuickPanel = useCallback(
    async (triggerInfo?: ResourcePanelTriggerInfo) => {
      const normalizedTriggerInfo =
        triggerInfo && triggerInfo.type === 'input'
          ? {
              ...triggerInfo,
              symbol: triggerInfo.symbol ?? QuickPanelReservedSymbol.MentionModels
            }
          : triggerInfo
      triggerInfoRef.current = normalizedTriggerInfo

      // Always load fresh files when opening the panel
      const files = await loadFiles()
      updateFileListState(files)

      const items = buildCategorizedList(files, enabledSkills, skillsLoading)

      open({
        title: t('chat.input.resource_panel.description'),
        list: items,
        symbol: QuickPanelReservedSymbol.MentionModels,
        manageListExternally: true,
        triggerInfo: normalizedTriggerInfo
          ? {
              type: normalizedTriggerInfo.type,
              position: normalizedTriggerInfo.position,
              originalText: normalizedTriggerInfo.originalText
            }
          : { type: 'button' },
        onClose({ action, searchText }) {
          if (action === 'esc') {
            const activeTrigger = triggerInfoRef.current
            if (activeTrigger?.type === 'input' && activeTrigger?.position !== undefined) {
              setText((currentText) => {
                const textArea = document.querySelector<HTMLTextAreaElement>('.inputbar textarea')
                const caret = textArea ? (textArea.selectionStart ?? currentText.length) : currentText.length
                const symbolForRemoval = activeTrigger.symbol ?? QuickPanelReservedSymbol.MentionModels
                return removeTriggerSymbolAndText(
                  currentText,
                  caret,
                  symbolForRemoval,
                  searchText || '',
                  activeTrigger.position
                )
              })
            }
          }
          // Clear file list and reset state when panel closes
          updateFileListState([])
          hasAttemptedLoadRef.current = false
          triggerInfoRef.current = undefined
        },
        onSearchChange: handleSearchChange
      })
    },
    [
      loadFiles,
      open,
      removeTriggerSymbolAndText,
      setText,
      t,
      handleSearchChange,
      buildCategorizedList,
      enabledSkills,
      skillsLoading,
      updateFileListState
    ]
  )

  /**
   * Handle button click - toggle panel open/close
   */
  const isMentionPanelActive = useCallback(() => {
    return quickPanelController.isVisible && quickPanelController.symbol === QuickPanelReservedSymbol.MentionModels
  }, [quickPanelController])

  const handleOpenQuickPanel = useCallback(() => {
    if (isMentionPanelActive()) {
      close()
    } else {
      void openQuickPanel({ type: 'button' })
    }
  }, [close, isMentionPanelActive, openQuickPanel])

  /**
   * Update list when data changes
   */
  useEffect(() => {
    if (role !== 'manager') return
    if (!hasAttemptedLoadRef.current && fileList.length === 0 && !isLoading) {
      return
    }
    if (isVisible && symbol === QuickPanelReservedSymbol.MentionModels) {
      updateList(categorizedItems)
    }
  }, [categorizedItems, fileList.length, enabledSkills.length, isLoading, isVisible, role, symbol, updateList])

  /**
   * Register trigger and root menu (manager only)
   */
  useEffect(() => {
    if (role !== 'manager') return

    const disposeLauncher = launcher.registerLaunchers([
      {
        id: 'resource-panel',
        kind: 'panel',
        sources: ['popover', 'root-panel'],
        order: 30,
        label: t('chat.input.resource_panel.title'),
        description: t('chat.input.resource_panel.description'),
        icon: <Folder size={16} />,
        action: ({ quickPanel: context }) => {
          const rootTrigger =
            context.triggerInfo && context.triggerInfo.type === 'input'
              ? {
                  ...context.triggerInfo,
                  symbol: QuickPanelReservedSymbol.Root
                }
              : undefined

          context.close('select')
          setTimeout(() => {
            void openQuickPanel(rootTrigger ?? { type: 'button' })
          }, 0)
        }
      }
    ])

    const disposeTrigger = registerTrigger(QuickPanelReservedSymbol.MentionModels, (payload) => {
      const trigger = (payload || {}) as ResourcePanelTriggerInfo
      void openQuickPanel(trigger)
    })

    return () => {
      disposeLauncher()
      disposeTrigger()
    }
  }, [launcher, openQuickPanel, registerTrigger, role, t])

  return {
    handleOpenQuickPanel,
    openQuickPanel,
    fileList,
    isLoading
  }
}
