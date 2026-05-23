import { ContextMenu as UiContextMenu, ContextMenuTrigger } from '@cherrystudio/ui'
import type { ReactNode } from 'react'
import { useCallback } from 'react'

import { type ResourceListItemBase, useResourceListActions, useResourceListItemAccessors } from './ResourceListContext'

type ResourceListContextMenuProps<T extends ResourceListItemBase> = {
  item: T
  children: ReactNode
  content: ReactNode
}

export function ResourceListContextMenu<T extends ResourceListItemBase>({
  item,
  children,
  content
}: ResourceListContextMenuProps<T>) {
  const actions = useResourceListActions()
  const { getItemId } = useResourceListItemAccessors<T>()
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) actions.openContextMenu(getItemId(item))
    },
    [actions, getItemId, item]
  )

  return (
    <UiContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {content}
    </UiContextMenu>
  )
}
