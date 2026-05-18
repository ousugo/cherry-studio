import { Button, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import { AlertCircle, CodeXml, Eye, FolderOpen, Maximize2, RotateCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ArtifactPane')

export const ARTIFACT_PANE_WIDTH = 460

export interface ArtifactPaneProps {
  workspacePath?: string
  onClose: () => void
}

interface WorkspaceEntriesResult {
  entries: string[]
  isLoading: boolean
  error?: Error
}

const useWorkspaceEntries = (path: string | undefined): WorkspaceEntriesResult => {
  const [entries, setEntries] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)

  useEffect(() => {
    if (!path) {
      setEntries([])
      setIsLoading(false)
      setError(undefined)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(undefined)

    window.api.file
      .listDirectory(path, {
        recursive: false,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true
      })
      .then((result) => {
        if (cancelled) return
        setEntries(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to list directory: ${path}`, normalized)
        setError(normalized)
        setEntries([])
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [path])

  return { entries, isLoading, error }
}

const ArtifactPane = ({ workspacePath, onClose }: ArtifactPaneProps) => {
  const { t } = useTranslation()
  const { entries, isLoading, error } = useWorkspaceEntries(workspacePath)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border-frame-border bg-card text-card-foreground shadow-sm">
      <div className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-1 border-border-subtle px-2">
        <div className="flex items-center gap-1">
          <Tooltip content={t('agent.preview_pane.file_tree')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('agent.preview_pane.file_tree')}>
              <FolderOpen size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('agent.preview_pane.preview')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('agent.preview_pane.preview')}>
              <Eye size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('agent.preview_pane.code')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('agent.preview_pane.code')}>
              <CodeXml size={16} />
            </Button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip content={t('agent.preview_pane.refresh')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('agent.preview_pane.refresh')}>
              <RotateCw size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('agent.preview_pane.maximize')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('agent.preview_pane.maximize')}>
              <Maximize2 size={16} />
            </Button>
          </Tooltip>
          <Tooltip content={t('agent.preview_pane.close')} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
              aria-label={t('agent.preview_pane.close')}>
              <X size={16} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
        {isLoading ? (
          <LoadingState variant="skeleton" rows={4} />
        ) : error ? (
          <EmptyState icon={AlertCircle} title={t('agent.preview_pane.empty.title')} description={error.message} />
        ) : !workspacePath || entries.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={t('agent.preview_pane.empty.title')}
            description={t('agent.preview_pane.empty.description')}
          />
        ) : (
          <div className="flex flex-col gap-1 text-foreground text-sm">
            <div className="truncate text-muted-foreground text-xs" title={workspacePath}>
              {workspacePath}
            </div>
            <div className="text-foreground-secondary">{t('agent.preview_pane.items', { count: entries.length })}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ArtifactPane
