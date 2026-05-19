import type { DragPosition, TreeListSlotArgs } from '@cherrystudio/ui'
import type React from 'react'

export type FileTreeNodeKind = 'file' | 'folder'

export interface FileTreeNode {
  id: string
  name: string
  kind: FileTreeNodeKind
  /** Canonical path consumed by @pierre/trees for model preparation. */
  path: string
  children?: FileTreeNode[]
}

export interface FileTreeRenameSlot {
  isRenaming: (node: FileTreeNode) => boolean
  /**
   * Props for the rename input - typically produced by `useInPlaceEdit`.
   * Spread on an `<input>` inside the renamed row.
   */
  inputProps: React.InputHTMLAttributes<HTMLInputElement>
}

export interface FileTreeProps {
  nodes: FileTreeNode[]

  expandedIds?: ReadonlySet<string>
  defaultExpandedIds?: ReadonlySet<string>
  onExpandedChange?: (next: ReadonlySet<string>) => void

  selectedId?: string | null
  defaultSelectedId?: string | null
  onSelectedChange?: (id: string | null) => void

  /** When omitted, drag-and-drop is fully disabled (read-only tree). */
  onMove?: (sourceId: string, targetId: string, position: DragPosition) => void

  /** When omitted, inline rename is disabled. */
  renameSlot?: FileTreeRenameSlot

  /** Optional trailing slot per row - e.g. ContextMenu trigger, action buttons, badges. */
  renderRowExtras?: (node: FileTreeNode) => React.ReactNode
  /** Optional context menu content for the whole row. */
  renderContextMenu?: (node: FileTreeNode) => React.ReactNode

  /** Override default folder/file icons. */
  fileIcon?: (node: FileTreeNode) => React.ReactNode
  folderIcon?: (node: FileTreeNode, expanded: boolean) => React.ReactNode

  /** Override the virtualizer slot. Default uses DynamicVirtualList. */
  renderList?: (args: TreeListSlotArgs<FileTreeNode>) => React.ReactNode
  /** Set when node paths are already in the final tree order. */
  presorted?: boolean
  /** When true, folder rows are treated as sticky headers by the default virtualizer. Default: true. */
  stickyFolders?: boolean

  emptyState?: React.ReactNode
}
