import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { WorkspacePathStatus } from '@shared/file/types/ipc'
import { Folder, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SessionWorkspaceMetaProps = {
  session: AgentSessionEntity
}

const SessionWorkspaceMeta = ({ session }: SessionWorkspaceMetaProps) => {
  const { t } = useTranslation()

  const workspacePath = session.workspace?.path
  const workspaceName = session.workspace?.name
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspacePathStatus | null>(null)

  useEffect(() => {
    let disposed = false
    setWorkspaceStatus(null)
    if (!workspacePath) return

    window.api.file
      .checkWorkspacePath(workspacePath)
      .then((status) => {
        if (!disposed) setWorkspaceStatus(status)
      })
      .catch(() => {
        if (!disposed) setWorkspaceStatus({ ok: false, reason: 'inaccessible' })
      })

    return () => {
      disposed = true
    }
  }, [workspacePath])

  const infoItems: ReactNode[] = []

  const getWorkspaceStatusMessage = (status: Exclude<WorkspacePathStatus, { ok: true }>) => {
    switch (status.reason) {
      case 'missing':
        return t('agent.session.workspace_status.missing', { path: workspacePath })
      case 'not-directory':
        return t('agent.session.workspace_status.not_directory', { path: workspacePath })
      case 'inaccessible':
        return t('agent.session.workspace_status.inaccessible', { path: workspacePath })
    }
  }

  const InfoTag = ({
    text,
    tooltip,
    className,
    icon,
    onClick
  }: {
    text: string
    tooltip?: string
    className?: string
    icon?: ReactNode
    onClick?: (e: React.MouseEvent) => void
  }) => (
    <div
      className={cn(
        'flex items-center gap-1.5 text-foreground-500 text-xs dark:text-foreground-400',
        onClick !== undefined ? 'cursor-pointer' : undefined,
        className
      )}
      title={tooltip ?? text}
      onClick={onClick}>
      {icon ?? <Folder className="h-3.5 w-3.5 shrink-0" />}
      <span className="block truncate">{text}</span>
    </div>
  )

  if (workspacePath) {
    const workspaceWarning = workspaceStatus?.ok === false ? getWorkspaceStatusMessage(workspaceStatus) : undefined

    infoItems.push(
      <InfoTag
        key="path"
        text={workspaceName || workspacePath}
        tooltip={workspaceWarning ?? workspacePath}
        icon={workspaceWarning ? <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> : undefined}
        className={cn(
          'max-w-60 transition-colors',
          workspaceWarning
            ? 'text-warning hover:text-warning dark:text-warning'
            : 'hover:border-primary hover:text-primary'
        )}
        onClick={() => {
          if (workspaceWarning) {
            window.toast.warning(workspaceWarning)
            return
          }
          window.api.file
            .openPath(workspacePath)
            .catch((e) =>
              window.toast.error(formatErrorMessageWithPrefix(e, t('files.error.open_path', { path: workspacePath })))
            )
        }}
      />
    )
  }

  if (infoItems.length === 0) {
    return null
  }

  return <div className="ml-2 flex items-center gap-2">{infoItems}</div>
}

export default SessionWorkspaceMeta
