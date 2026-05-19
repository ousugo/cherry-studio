import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { Folder } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type SessionWorkspaceMetaProps = {
  session: AgentSessionEntity
}

const SessionWorkspaceMeta = ({ session }: SessionWorkspaceMetaProps) => {
  const { t } = useTranslation()

  const workspacePath = session.workspace?.path
  const workspaceName = session.workspace?.name

  const infoItems: ReactNode[] = []

  const InfoTag = ({
    text,
    tooltip,
    className,
    onClick
  }: {
    text: string
    tooltip?: string
    className?: string
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
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="block truncate">{text}</span>
    </div>
  )

  if (workspacePath) {
    infoItems.push(
      <InfoTag
        key="path"
        text={workspaceName || workspacePath}
        tooltip={workspacePath}
        className="max-w-60 transition-colors hover:border-primary hover:text-primary"
        onClick={() => {
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
