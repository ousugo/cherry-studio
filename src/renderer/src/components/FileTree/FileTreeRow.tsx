import { ContextMenu, ContextMenuContent, ContextMenuTrigger, type RenderRowArgs } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ChevronDown, ChevronRight, File as FileIcon, Folder, FolderOpen } from 'lucide-react'
import type React from 'react'

import type { FileTreeNode, FileTreeRenameSlot } from './types'

interface FileTreeRowProps {
  args: RenderRowArgs<FileTreeNode>
  renameSlot?: FileTreeRenameSlot
  renderRowExtras?: (node: FileTreeNode) => React.ReactNode
  renderContextMenu?: (node: FileTreeNode) => React.ReactNode
  fileIcon?: (node: FileTreeNode) => React.ReactNode
  folderIcon?: (node: FileTreeNode, expanded: boolean) => React.ReactNode
}

const INDENT_PX = 16

export function FileTreeRow(props: FileTreeRowProps) {
  const { args, renameSlot, renderRowExtras, renderContextMenu, fileIcon, folderIcon } = props
  const { node, depth, isExpanded, isSelected, isDragging, dragPosition, toggleExpanded, selectNode, dragHandleProps } =
    args

  const isFolder = node.kind === 'folder'
  const isRenaming = renameSlot ? renameSlot.isRenaming(node) : false
  const effectiveDragHandleProps = isRenaming ? { ...dragHandleProps, draggable: false } : dragHandleProps

  const renderIcon = () => {
    if (isFolder) {
      return folderIcon ? (
        folderIcon(node, isExpanded)
      ) : isExpanded ? (
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Folder className="h-4 w-4 text-muted-foreground" />
      )
    }
    return fileIcon ? fileIcon(node) : <FileIcon className="h-4 w-4 text-muted-foreground" />
  }

  const row = (
    <div
      {...effectiveDragHandleProps}
      data-node-id={node.id}
      data-kind={node.kind}
      onClick={selectNode}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn(
        'group relative flex select-none items-center gap-1 rounded-md px-1.5 py-1 text-sm leading-5',
        'transition-colors',
        'hover:bg-accent/60',
        isSelected && 'bg-accent text-accent-foreground',
        isDragging && 'opacity-50',
        dragPosition === 'inside' && 'bg-primary/15 ring-1 ring-primary/40',
        dragPosition === 'before' &&
          "before:-top-px before:absolute before:inset-x-1 before:h-0.5 before:rounded before:bg-primary before:content-['']",
        dragPosition === 'after' &&
          "after:-bottom-px after:absolute after:inset-x-1 after:h-0.5 after:rounded after:bg-primary after:content-['']"
      )}>
      <span style={{ width: depth * INDENT_PX }} aria-hidden className="flex-shrink-0" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isFolder) toggleExpanded()
        }}
        className={cn(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground',
          !isFolder && 'invisible'
        )}
        tabIndex={-1}
        aria-hidden={!isFolder}>
        {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{renderIcon()}</span>

      {isRenaming && renameSlot ? (
        <input
          {...renameSlot.inputProps}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'min-w-0 flex-1 rounded border bg-background px-1 text-sm leading-4 outline-none',
            renameSlot.inputProps.className
          )}
          autoFocus
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      )}

      {renderRowExtras ? (
        <span onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          {renderRowExtras(node)}
        </span>
      ) : null}
    </div>
  )

  if (!renderContextMenu) {
    return row
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>{renderContextMenu(node)}</ContextMenuContent>
    </ContextMenu>
  )
}
