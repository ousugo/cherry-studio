import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  TOPIC_MESSAGE_FLOW_NODE_TYPE,
  TopicMessageFlowCanvas,
  type TopicMessageFlowLayout,
  type TopicMessageFlowNodeModel
} from '../index'

vi.mock('@xyflow/react', async () => {
  const React = await import('react')

  return {
    Controls: (props: Record<string, unknown>) =>
      React.createElement('div', { 'data-position': props.position, 'data-testid': 'flow-controls' }),
    Handle: () => React.createElement('span', { 'data-testid': 'flow-handle' }),
    MiniMap: (props: Record<string, unknown>) =>
      React.createElement('div', {
        className: props.className as string,
        'data-bg-color': props.bgColor,
        'data-position': props.position,
        'data-testid': 'flow-minimap'
      }),
    Position: {
      Bottom: 'bottom',
      Top: 'top'
    },
    ReactFlow: ({
      children,
      edges,
      fitView,
      fitViewOptions,
      nodeTypes,
      nodes,
      nodesConnectable,
      nodesDraggable,
      onNodeClick,
      proOptions
    }: {
      children: ReactNode
      edges: unknown[]
      fitView?: boolean
      fitViewOptions?: { maxZoom?: number; padding?: number }
      nodeTypes: Record<string, React.ComponentType<any>>
      nodes: TopicMessageFlowNodeModel[]
      nodesConnectable?: boolean
      nodesDraggable?: boolean
      onNodeClick?: (event: React.MouseEvent, node: TopicMessageFlowNodeModel) => void
      proOptions?: { hideAttribution?: boolean }
    }) =>
      React.createElement(
        'div',
        {
          'data-edges': edges.length,
          'data-fit-view': fitView ? 'true' : 'false',
          'data-fit-view-max-zoom': fitViewOptions?.maxZoom,
          'data-fit-view-padding': fitViewOptions?.padding,
          'data-hide-attribution': proOptions?.hideAttribution ? 'true' : 'false',
          'data-nodes-connectable': nodesConnectable ? 'true' : 'false',
          'data-nodes-draggable': nodesDraggable ? 'true' : 'false',
          'data-testid': 'react-flow'
        },
        nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type ?? TOPIC_MESSAGE_FLOW_NODE_TYPE]

          return React.createElement(
            'div',
            {
              'data-testid': `flow-node-${node.data.messageId}`,
              key: node.id,
              onClick: (event: React.MouseEvent) => onNodeClick?.(event, node)
            },
            React.createElement(NodeComponent, {
              data: node.data,
              id: node.id,
              selected: node.selected ?? false
            })
          )
        }),
        children
      )
  }
})

const graph: TopicMessageFlowLayout = {
  activeNodeId: 'assistant-1',
  edges: [
    {
      id: 'user-1-assistant-1',
      source: 'user-1',
      target: 'assistant-1',
      data: {
        isActivePath: true,
        isInactiveBranch: false,
        isSiblingBranch: false
      }
    }
  ],
  nodes: [
    {
      id: 'user-1',
      type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
      position: { x: 0, y: 0 },
      data: {
        createdAt: '2026-01-01T00:00:00.000Z',
        isActive: false,
        isInactiveBranch: false,
        isOnActivePath: true,
        messageId: 'user-1',
        preview: 'Plan the topic branch',
        role: 'user',
        status: 'success'
      }
    },
    {
      id: 'assistant-1',
      type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
      position: { x: 260, y: 120 },
      data: {
        createdAt: '2026-01-01T00:01:00.000Z',
        isActive: true,
        isInactiveBranch: false,
        isOnActivePath: true,
        messageId: 'assistant-1',
        modelId: 'openai/gpt-5-codex',
        preview: 'Here is the branch overview.',
        role: 'assistant',
        status: 'pending',
        siblingsGroupId: 2
      }
    }
  ],
  stats: {
    activePathLength: 2,
    branchCount: 1,
    nodeCount: 2
  }
}

describe('TopicMessageFlowCanvas', () => {
  it('renders the read-only React Flow surface with custom nodes and overlays', () => {
    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)

    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view', 'true')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view-max-zoom', '1')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view-padding', '0.22')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-hide-attribution', 'true')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-nodes-draggable', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-nodes-connectable', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-edges', '1')
    expect(screen.getByTestId('flow-controls')).toBeInTheDocument()
    expect(screen.getByTestId('flow-minimap')).toHaveAttribute('data-bg-color', 'var(--color-card)')
    expect(screen.getByTestId('flow-minimap')).toHaveClass('border-border')
    expect(screen.getByTestId('topic-message-flow-legend')).toBeInTheDocument()
    expect(screen.getByText('Plan the topic branch')).toBeInTheDocument()
    expect(screen.getByText('gpt-5-codex')).toBeInTheDocument()
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })

  it('calls onNodeSelect with the clicked message id', () => {
    const onNodeSelect = vi.fn()

    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={onNodeSelect} />)

    fireEvent.click(screen.getByTestId('flow-node-assistant-1'))

    expect(onNodeSelect).toHaveBeenCalledWith('assistant-1')
  })

  it('renders active error nodes with the error state marker', () => {
    render(
      <TopicMessageFlowCanvas
        graph={{
          activeNodeId: 'error-1',
          edges: [],
          nodes: [
            {
              id: 'error-1',
              type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
              position: { x: 0, y: 0 },
              data: {
                createdAt: '2026-01-01T00:02:00.000Z',
                isActive: true,
                isInactiveBranch: false,
                isOnActivePath: true,
                messageId: 'error-1',
                preview: 'Broken branch.',
                role: 'assistant',
                status: 'error'
              }
            }
          ],
          stats: {
            activePathLength: 1,
            branchCount: 0,
            nodeCount: 1
          }
        }}
        onNodeSelect={vi.fn()}
      />
    )

    const errorNode = screen.getByText('Broken branch.').closest('[data-message-id="error-1"]')

    expect(errorNode).toHaveAttribute('data-active', 'true')
    expect(errorNode?.querySelector('.bg-destructive')).toBeInTheDocument()
  })
})
