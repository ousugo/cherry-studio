import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  TOPIC_MESSAGE_FLOW_NODE_TYPE,
  TopicMessageFlowCanvas,
  type TopicMessageFlowLayout,
  type TopicMessageFlowNodeModel
} from '../index'

const { setViewportMock } = vi.hoisted(() => ({
  setViewportMock: vi.fn()
}))

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
      defaultViewport,
      edges,
      fitView,
      fitViewOptions,
      maxZoom,
      minZoom,
      nodeTypes,
      nodes,
      nodesConnectable,
      nodesDraggable,
      onInit,
      onNodeClick,
      onlyRenderVisibleElements,
      proOptions
    }: {
      children: ReactNode
      defaultViewport?: { x: number; y: number; zoom: number }
      edges: unknown[]
      fitView?: boolean
      fitViewOptions?: { maxZoom?: number; padding?: number }
      maxZoom?: number
      minZoom?: number
      nodeTypes: Record<string, React.ComponentType<any>>
      nodes: TopicMessageFlowNodeModel[]
      nodesConnectable?: boolean
      nodesDraggable?: boolean
      onInit?: (instance: { setViewport: typeof setViewportMock }) => void
      onNodeClick?: (event: React.MouseEvent, node: TopicMessageFlowNodeModel) => void
      onlyRenderVisibleElements?: boolean
      proOptions?: { hideAttribution?: boolean }
    }) => {
      React.useEffect(() => {
        onInit?.({ setViewport: setViewportMock })
      }, [onInit])

      return React.createElement(
        'div',
        {
          'data-edges': edges.length,
          'data-default-zoom': defaultViewport?.zoom,
          'data-fit-view': fitView ? 'true' : 'false',
          'data-fit-view-max-zoom': fitViewOptions?.maxZoom,
          'data-fit-view-padding': fitViewOptions?.padding,
          'data-hide-attribution': proOptions?.hideAttribution ? 'true' : 'false',
          'data-max-zoom': maxZoom,
          'data-min-zoom': minZoom,
          'data-nodes-connectable': nodesConnectable ? 'true' : 'false',
          'data-nodes-draggable': nodesDraggable ? 'true' : 'false',
          'data-only-render-visible-elements': onlyRenderVisibleElements ? 'true' : 'false',
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

    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-fit-view', 'false')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-default-zoom', '0.85')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-min-zoom', '0.08')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-max-zoom', '1.4')
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-only-render-visible-elements', 'true')
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

  it('starts with the root node centered horizontally near the top', () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    setViewportMock.mockClear()

    render(<TopicMessageFlowCanvas graph={graph} onNodeSelect={vi.fn()} />)

    expect(setViewportMock).toHaveBeenCalledWith({ x: 306.5, y: 64, zoom: 0.85 }, { duration: 0 })

    clientWidthSpy.mockRestore()
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
