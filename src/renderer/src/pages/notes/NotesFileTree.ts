import type { FileTreeNode } from '@renderer/components/FileTree'
import type { NotesTreeNode } from '@renderer/types/note'

export interface NotesFileTreeModel {
  nodes: FileTreeNode[]
  byId: ReadonlyMap<string, NotesTreeNode>
  expandedIds: ReadonlySet<string>
}

export function buildNotesFileTreeModel(notesTree: NotesTreeNode[]): NotesFileTreeModel {
  const byId = new Map<string, NotesTreeNode>()
  const expandedIds = new Set<string>()

  const mapNodes = (nodes: NotesTreeNode[]): FileTreeNode[] => {
    const mapped: FileTreeNode[] = []

    for (const node of nodes) {
      if (node.type !== 'file' && node.type !== 'folder') {
        continue
      }

      byId.set(node.id, node)

      if (node.type === 'folder' && node.expanded) {
        expandedIds.add(node.id)
      }

      const fileTreeNode: FileTreeNode = {
        id: node.id,
        name: node.name,
        kind: node.type,
        path: node.treePath
      }

      if (node.type === 'folder' && node.children?.length) {
        fileTreeNode.children = mapNodes(node.children)
      }

      mapped.push(fileTreeNode)
    }

    return mapped
  }

  return {
    nodes: mapNodes(notesTree),
    byId,
    expandedIds
  }
}

export function getChangedExpandedId(current: ReadonlySet<string>, next: ReadonlySet<string>): string | null {
  for (const id of next) {
    if (!current.has(id)) {
      return id
    }
  }

  for (const id of current) {
    if (!next.has(id)) {
      return id
    }
  }

  return null
}
