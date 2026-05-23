import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

import type { ResourceListItemBase } from '../resources/ResourceListContext'
import { ResourceListContextMenu } from '../resources/ResourceListContextMenu'
import { ActionMenu } from './ActionMenu'
import type { ResolvedAction } from './actionTypes'

type ResourceListActionContextMenuProps<T extends ResourceListItemBase, TActionContext = unknown> = {
  actions: readonly ResolvedAction<TActionContext>[]
  item: T
  children: ReactNode
  className?: string
  confirmDialogContentClassName?: string
  confirmDialogOverlayClassName?: string
  onAction: (action: ResolvedAction<TActionContext>) => void | Promise<void>
}

export function ResourceListActionContextMenu<T extends ResourceListItemBase, TActionContext = unknown>({
  actions,
  item,
  children,
  className,
  confirmDialogContentClassName,
  confirmDialogOverlayClassName,
  onAction
}: ResourceListActionContextMenuProps<T, TActionContext>) {
  const [contextMenuKey, setContextMenuKey] = useState(0)
  const handleAction = useCallback(
    (action: ResolvedAction<TActionContext>) => {
      setContextMenuKey((key) => key + 1)
      window.requestAnimationFrame(() => {
        void onAction(action)
      })
    },
    [onAction]
  )

  return (
    <ResourceListContextMenu
      key={contextMenuKey}
      item={item}
      content={
        <ActionMenu
          actions={actions}
          className={className}
          confirmDialogContentClassName={confirmDialogContentClassName}
          confirmDialogOverlayClassName={confirmDialogOverlayClassName}
          onAction={handleAction}
          onConfirmActionComplete={() => setContextMenuKey((key) => key + 1)}
        />
      }>
      {children}
    </ResourceListContextMenu>
  )
}
