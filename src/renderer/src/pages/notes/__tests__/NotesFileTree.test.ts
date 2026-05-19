import type { NotesTreeNode } from '@renderer/types/note'
import { describe, expect, it } from 'vitest'

import { buildNotesFileTreeModel, getChangedExpandedId } from '../NotesFileTree'

const baseNode = {
  externalPath: '/notes',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const notesTree: NotesTreeNode[] = [
  {
    ...baseNode,
    id: 'folder-a',
    name: 'Folder A',
    type: 'folder',
    treePath: 'folder-a',
    expanded: true,
    children: [
      {
        ...baseNode,
        id: 'note-a',
        name: 'Note A',
        type: 'file',
        treePath: 'folder-a/note-a'
      },
      {
        ...baseNode,
        id: 'folder-b',
        name: 'Folder B',
        type: 'folder',
        treePath: 'folder-a/folder-b',
        expanded: false,
        children: [
          {
            ...baseNode,
            id: 'note-b',
            name: 'Note B',
            type: 'file',
            treePath: 'folder-a/folder-b/note-b'
          }
        ]
      }
    ]
  }
]

describe('NotesFileTree', () => {
  it('maps notes tree nodes to FileTree nodes and keeps original nodes by id', () => {
    const model = buildNotesFileTreeModel(notesTree)

    expect(model.nodes).toEqual([
      {
        id: 'folder-a',
        name: 'Folder A',
        kind: 'folder',
        path: 'folder-a',
        children: [
          {
            id: 'note-a',
            name: 'Note A',
            kind: 'file',
            path: 'folder-a/note-a'
          },
          {
            id: 'folder-b',
            name: 'Folder B',
            kind: 'folder',
            path: 'folder-a/folder-b',
            children: [
              {
                id: 'note-b',
                name: 'Note B',
                kind: 'file',
                path: 'folder-a/folder-b/note-b'
              }
            ]
          }
        ]
      }
    ])
    expect(model.byId.get('note-b')?.treePath).toBe('folder-a/folder-b/note-b')
  })

  it('collects expanded ids only from expanded folders', () => {
    const model = buildNotesFileTreeModel(notesTree)

    expect([...model.expandedIds]).toEqual(['folder-a'])
  })

  it('returns the changed expanded id between two sets', () => {
    expect(getChangedExpandedId(new Set(['folder-a']), new Set(['folder-a', 'folder-b']))).toBe('folder-b')
    expect(getChangedExpandedId(new Set(['folder-a', 'folder-b']), new Set(['folder-a']))).toBe('folder-b')
    expect(getChangedExpandedId(new Set(['folder-a']), new Set(['folder-a']))).toBeNull()
  })
})
