import {
  type FlatTreeItem,
  type RenderRowFn,
  type TreeListSlotArgs,
  type TreeNodeAdapter,
  TreeView
} from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useCallback, useMemo } from 'react'

import { FileTreeRow } from './FileTreeRow'
import type { FileTreeNode, FileTreeProps } from './types'
import { useFileTreeModel } from './useFileTreeModel'

const DEFAULT_ITEM_SIZE = 28
const VIRTUAL_OVERSCAN = 10

/**
 * File-tree component built on top of TreeView.
 *
 * Two interaction modes are achieved purely by which props you pass:
 * - Editable: pass `onMove`, `renameSlot`, and `renderRowExtras` (for menus/buttons).
 * - Read-only: omit those props. The same component renders with drag disabled,
 *   rename disabled, and no trailing slot.
 *
 * The sticky-folder behaviour requires the surrounding scroll container to set
 * `isolation: isolate` to keep sticky headers under sibling UI like a global navbar.
 */
export function FileTree(props: FileTreeProps) {
  const {
    nodes,
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
    selectedId,
    defaultSelectedId,
    onSelectedChange,
    onMove,
    renameSlot,
    renderRowExtras,
    renderContextMenu,
    fileIcon,
    folderIcon,
    renderList,
    presorted,
    stickyFolders = true,
    emptyState
  } = props

  const model = useFileTreeModel(nodes, { presorted })

  const adapter = useMemo<TreeNodeAdapter<FileTreeNode>>(
    () => ({
      getId: (n) => n.id,
      getChildren: (n) => n.children,
      canHaveChildren: (n) => n.kind === 'folder',
      isSticky: stickyFolders ? (n) => n.kind === 'folder' : undefined
    }),
    [stickyFolders]
  )

  const renderRow: RenderRowFn<FileTreeNode> = useCallback(
    (args) => (
      <FileTreeRow
        args={args}
        renameSlot={renameSlot}
        renderRowExtras={renderRowExtras}
        renderContextMenu={renderContextMenu}
        fileIcon={fileIcon}
        folderIcon={folderIcon}
      />
    ),
    [renameSlot, renderRowExtras, renderContextMenu, fileIcon, folderIcon]
  )

  const defaultRenderList = useCallback(
    ({ flat, isSticky, getItemDepth, renderItem }: TreeListSlotArgs<FileTreeNode>) => (
      <DynamicVirtualList
        list={flat as FlatTreeItem<FileTreeNode>[]}
        estimateSize={() => DEFAULT_ITEM_SIZE}
        overscan={VIRTUAL_OVERSCAN}
        isSticky={isSticky}
        getItemDepth={getItemDepth}>
        {(_item, index) => renderItem(index)}
      </DynamicVirtualList>
    ),
    []
  )

  return (
    <TreeView<FileTreeNode>
      data={model.nodes}
      adapter={adapter}
      expandedIds={expandedIds}
      defaultExpandedIds={defaultExpandedIds}
      onExpandedChange={onExpandedChange}
      selectedId={selectedId}
      defaultSelectedId={defaultSelectedId}
      onSelectedChange={onSelectedChange}
      onMove={onMove}
      renderRow={renderRow}
      renderList={renderList ?? defaultRenderList}
      emptyState={emptyState}
    />
  )
}
