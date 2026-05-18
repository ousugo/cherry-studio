import {
  Button,
  ButtonGroup,
  MenuItem,
  MenuList,
  NormalTooltip,
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { FinderIcon } from '@renderer/components/Icons/SVGIcon'
import { isMac, isWin } from '@renderer/config/constant'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import { buildEditorUrl, getEditorIcon } from '@renderer/utils/editorUtils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ExternalAppId, ExternalAppInfo } from '@shared/externalApp/types'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const FILE_MANAGER_TARGET = 'file_manager' as const

type OpenExternalAppButtonProps = {
  workdir: string
  className?: string
}

type OpenTarget = ExternalAppId | typeof FILE_MANAGER_TARGET

const OpenExternalAppButton = ({ workdir, className }: OpenExternalAppButtonProps) => {
  const { t } = useTranslation()
  const { data: externalApps } = useExternalApps()
  const [lastUsedTarget, setLastUsedTarget] = usePersistCache('agent.open_external_app.last_used_target')

  const availableEditors = useMemo(() => {
    if (!externalApps) {
      return []
    }
    return externalApps.filter((app) => app.tags.includes('code-editor'))
  }, [externalApps])

  const fileManagerName = useMemo(() => {
    if (isMac) {
      return t('agent.session.file_manager.finder')
    }
    if (isWin) {
      return t('agent.session.file_manager.file_explorer')
    }
    return t('agent.session.file_manager.files')
  }, [t])

  const selectedTarget = useMemo<OpenTarget>(() => {
    if (lastUsedTarget === FILE_MANAGER_TARGET) {
      return FILE_MANAGER_TARGET
    }
    if (lastUsedTarget && availableEditors.some((app) => app.id === lastUsedTarget)) {
      return lastUsedTarget
    }
    return availableEditors[0]?.id ?? FILE_MANAGER_TARGET
  }, [availableEditors, lastUsedTarget])

  const selectedEditor = useMemo(() => {
    if (selectedTarget === FILE_MANAGER_TARGET) {
      return undefined
    }
    return availableEditors.find((app) => app.id === selectedTarget)
  }, [availableEditors, selectedTarget])

  const openInEditor = useCallback(
    (app: ExternalAppInfo) => {
      window.open(buildEditorUrl(app, workdir))
      setLastUsedTarget(app.id)
    },
    [setLastUsedTarget, workdir]
  )

  const openFileManager = useCallback(async () => {
    try {
      await window.api.file.openPath(workdir)
      setLastUsedTarget(FILE_MANAGER_TARGET)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: workdir })))
    }
  }, [setLastUsedTarget, t, workdir])

  const handlePrimaryClick = useCallback(() => {
    if (selectedEditor) {
      openInEditor(selectedEditor)
      return
    }
    void openFileManager()
  }, [openFileManager, openInEditor, selectedEditor])

  const renderFileManagerIcon = () => (isMac ? <FinderIcon className="size-4" /> : <FolderOpen size={16} />)
  const selectedName = selectedEditor?.name ?? fileManagerName
  const primaryIcon = selectedEditor ? getEditorIcon(selectedEditor) : renderFileManagerIcon()
  const primaryLabel = t('common.open_in', { name: selectedName })

  if (availableEditors.length === 0) {
    return (
      <NormalTooltip content={primaryLabel} delayDuration={500}>
        <Button
          variant="outline"
          size="icon-sm"
          className={className}
          aria-label={primaryLabel}
          onClick={handlePrimaryClick}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
    )
  }

  return (
    <ButtonGroup className={className}>
      <NormalTooltip content={primaryLabel} delayDuration={500}>
        <Button
          className="h-7 min-w-[35px] w-[35px] p-0"
          variant="outline"
          size="icon-sm"
          aria-label={primaryLabel}
          onClick={handlePrimaryClick}>
          {primaryIcon}
        </Button>
      </NormalTooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button className="h-7 min-w-7 w-7 p-0" variant="outline" size="icon-sm" aria-label={t('common.more')}>
            <ChevronDown size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1" align="end">
          <MenuList>
            <MenuItem
              label={fileManagerName}
              icon={renderFileManagerIcon()}
              active={selectedTarget === FILE_MANAGER_TARGET}
              onClick={() => void openFileManager()}
            />
            {availableEditors.map((app) => (
              <MenuItem
                key={app.id}
                label={app.name}
                icon={getEditorIcon(app)}
                active={selectedTarget === app.id}
                onClick={() => openInEditor(app)}
              />
            ))}
          </MenuList>
        </PopoverContent>
      </Popover>
    </ButtonGroup>
  )
}

export default OpenExternalAppButton
