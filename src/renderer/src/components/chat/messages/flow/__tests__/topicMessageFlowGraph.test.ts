import type { TreeNode, TreeResponse } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildTopicMessageFlowGraph } from '../topicMessageFlowGraph'

const createdAt = '2026-05-22T00:00:00.000Z'

function treeNode({ id, ...overrides }: Partial<TreeNode> & Pick<TreeNode, 'id'>): TreeNode {
  return {
    id,
    parentId: null,
    role: 'user',
    preview: id,
    modelId: null,
    status: 'success',
    createdAt,
    hasChildren: false,
    ...overrides
  }
}

function siblingNode(
  overrides: Partial<Omit<TreeNode, 'parentId'>> & Pick<TreeNode, 'id'>
): Omit<TreeNode, 'parentId'> {
  const { parentId: _parentId, ...node } = treeNode(overrides)
  void _parentId

  return node
}

describe('buildTopicMessageFlowGraph', () => {
  it('builds nodes and edges for a linear tree', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-2', parentId: 'assistant-1' })
      ],
      siblingsGroups: [],
      activeNodeId: 'user-2'
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => node.id)).toEqual(['root', 'assistant-1', 'user-2'])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['root', 'assistant-1'],
      ['assistant-1', 'user-2']
    ])
    expect(graph.stats).toEqual({
      nodeCount: 3,
      branchCount: 0,
      activePathLength: 3
    })
    expect(graph.nodes.every((node) => node.data.isOnActivePath)).toBe(true)
    expect(graph.edges.every((edge) => edge.data.isActivePath)).toBe(true)
  })

  it('expands sibling groups into branch nodes and marks sibling edges', () => {
    const tree: TreeResponse = {
      nodes: [treeNode({ id: 'root', hasChildren: true })],
      siblingsGroups: [
        {
          parentId: 'root',
          siblingsGroupId: 7,
          nodes: [
            siblingNode({ id: 'assistant-a', role: 'assistant', modelId: 'model-a' }),
            siblingNode({ id: 'assistant-b', role: 'assistant', modelId: 'model-b' })
          ]
        }
      ],
      activeNodeId: 'assistant-b'
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.map((node) => [node.id, node.parentId, node.data.siblingsGroupId])).toEqual([
      ['root', null, undefined],
      ['assistant-a', 'root', 7],
      ['assistant-b', 'root', 7]
    ])
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.every((edge) => edge.data.isSiblingBranch)).toBe(true)
    expect(graph.stats.branchCount).toBe(2)
  })

  it('counts regular same-parent children as branch paths even without a sibling group', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-web', parentId: 'assistant-1', createdAt: '2026-05-22T14:17:00.000Z', hasChildren: true }),
        treeNode({
          id: 'assistant-web',
          parentId: 'user-web',
          role: 'assistant',
          createdAt: '2026-05-22T14:17:01.000Z'
        }),
        treeNode({
          id: 'user-scenes',
          parentId: 'assistant-1',
          createdAt: '2026-05-22T14:20:00.000Z',
          hasChildren: true
        }),
        treeNode({
          id: 'assistant-scenes',
          parentId: 'user-scenes',
          role: 'assistant',
          createdAt: '2026-05-22T14:20:01.000Z'
        })
      ],
      siblingsGroups: [],
      activeNodeId: 'assistant-web'
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.stats.branchCount).toBe(2)
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'root',
      'assistant-1',
      'user-web',
      'assistant-web',
      'user-scenes',
      'assistant-scenes'
    ])
  })

  it('marks the active node and its ancestors as the active path', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'assistant-1', parentId: 'root', role: 'assistant', hasChildren: true }),
        treeNode({ id: 'user-2', parentId: 'assistant-1' }),
        treeNode({ id: 'side-branch', parentId: 'root', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'user-2'
    }

    const graph = buildTopicMessageFlowGraph(tree)

    const activePath = graph.nodes.filter((node) => node.data.isOnActivePath).map((node) => node.id)
    expect(activePath).toEqual(['root', 'assistant-1', 'user-2'])
    expect(graph.nodes.find((node) => node.id === 'user-2')?.data.isActive).toBe(true)
    expect(graph.stats.activePathLength).toBe(3)
  })

  it('returns an empty graph for an empty tree', () => {
    const graph = buildTopicMessageFlowGraph({
      nodes: [],
      siblingsGroups: [],
      activeNodeId: null
    })

    expect(graph).toEqual({
      nodes: [],
      edges: [],
      activeNodeId: null,
      stats: {
        nodeCount: 0,
        branchCount: 0,
        activePathLength: 0
      }
    })
  })

  it('marks nodes and edges outside the active path as inactive branches', () => {
    const tree: TreeResponse = {
      nodes: [
        treeNode({ id: 'root', hasChildren: true }),
        treeNode({ id: 'active-leaf', parentId: 'root', role: 'assistant' }),
        treeNode({ id: 'inactive-leaf', parentId: 'root', role: 'assistant' })
      ],
      siblingsGroups: [],
      activeNodeId: 'active-leaf'
    }

    const graph = buildTopicMessageFlowGraph(tree)

    expect(graph.nodes.find((node) => node.id === 'inactive-leaf')?.data.isInactiveBranch).toBe(true)
    expect(graph.nodes.find((node) => node.id === 'active-leaf')?.data.isInactiveBranch).toBe(false)
    expect(graph.edges.find((edge) => edge.target === 'inactive-leaf')?.data.isInactiveBranch).toBe(true)
    expect(graph.edges.find((edge) => edge.target === 'active-leaf')?.data.isInactiveBranch).toBe(false)
  })
})
