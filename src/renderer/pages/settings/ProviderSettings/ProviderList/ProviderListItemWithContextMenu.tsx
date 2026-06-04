import { MenuItem, MenuList, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/commands'
import ModelNotesPopup from '@renderer/pages/settings/ProviderSettings/ModelNotesPopup'
import { providerListClasses } from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { cn } from '@renderer/utils'
import type { Provider } from '@shared/data/types/provider'
import { CopyPlus, Edit, Trash2, UserPen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderListItem from '../components/ProviderListItem'

type ProviderMenuEntry = {
  id: 'edit' | 'duplicate' | 'notes' | 'delete'
  label: string
  icon: ReactNode
  destructive?: boolean
  onSelect: () => void
}

type ListDragState = { dragging: boolean }

interface ProviderListItemWithContextMenuProps {
  provider: Provider
  selected: boolean
  contextOpen: boolean
  onContextOpenChange: (open: boolean) => void
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onDuplicate?: () => void
  showManagementActions: boolean
  listState: ListDragState
  onSetListItemRef: (providerId: string, element: HTMLDivElement | null) => void
}

export default function ProviderListItemWithContextMenu({
  provider,
  selected,
  contextOpen,
  onContextOpenChange,
  onSelect,
  onEdit,
  onDelete,
  onDuplicate,
  showManagementActions,
  listState,
  onSetListItemRef
}: ProviderListItemWithContextMenuProps) {
  const { t } = useTranslation()

  const menuEntries = useMemo<readonly ProviderMenuEntry[]>(() => {
    const entries: ProviderMenuEntry[] = []
    if (showManagementActions) {
      entries.push({ id: 'edit', label: t('common.edit'), icon: <Edit size={14} />, onSelect: onEdit })
    }
    if (onDuplicate) {
      entries.push({
        id: 'duplicate',
        label: t('settings.provider.duplicate.menu_label'),
        icon: <CopyPlus size={14} />,
        onSelect: onDuplicate
      })
    }
    entries.push({
      id: 'notes',
      label: t('settings.provider.notes.title'),
      icon: <UserPen size={14} />,
      onSelect: () => ModelNotesPopup.show({ providerId: provider.id })
    })
    if (showManagementActions) {
      entries.push({
        id: 'delete',
        label: t('common.delete'),
        icon: <Trash2 size={14} />,
        destructive: true,
        onSelect: onDelete
      })
    }
    return entries
  }, [onDelete, onDuplicate, onEdit, provider.id, showManagementActions, t])

  const handleEntrySelect = (entry: ProviderMenuEntry) => () => {
    entry.onSelect()
    onContextOpenChange(false)
  }

  const contextMenuItems = useMemo<readonly CommandContextMenuExtraItem[]>(
    () =>
      menuEntries.map((entry) => ({
        type: 'item' as const,
        id: entry.id,
        label: entry.label,
        icon: entry.icon,
        destructive: entry.destructive,
        onSelect: handleEntrySelect(entry)
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuEntries, onContextOpenChange]
  )

  return (
    <Popover open={contextOpen} onOpenChange={onContextOpenChange}>
      <CommandContextMenu location="webcontents.context" extraItems={contextMenuItems}>
        <div className="w-full" ref={(element) => onSetListItemRef(provider.id, element)}>
          <ProviderListItem
            provider={{ ...provider, name: getFancyProviderName(provider) }}
            selected={selected}
            dragging={listState.dragging}
            onClick={onSelect}
            onOpenMenu={() => onContextOpenChange(true)}
            renderMenuButton={(button) => <PopoverAnchor asChild>{button}</PopoverAnchor>}
          />
        </div>
      </CommandContextMenu>
      <PopoverContent align="end" className={providerListClasses.itemMenuContent}>
        <MenuList className="gap-1">
          {menuEntries.map((entry) => (
            <MenuItem
              key={entry.id}
              label={entry.label}
              className={cn(providerListClasses.itemMenuEntry, entry.destructive && 'text-(--color-destructive)')}
              icon={entry.icon}
              onClick={handleEntrySelect(entry)}
            />
          ))}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
