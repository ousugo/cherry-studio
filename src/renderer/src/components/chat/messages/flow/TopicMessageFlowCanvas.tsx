import '@xyflow/react/dist/style.css'

import { cn } from '@renderer/utils'
import { Controls, MiniMap, type NodeMouseHandler, type NodeTypes, ReactFlow, type ReactFlowProps } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import TopicMessageFlowLegend from './TopicMessageFlowLegend'
import TopicMessageFlowNode from './TopicMessageFlowNode'
import type { TopicMessageFlowEdgeModel, TopicMessageFlowLayout, TopicMessageFlowNodeModel } from './types'
import { TOPIC_MESSAGE_FLOW_NODE_TYPE } from './types'

export interface TopicMessageFlowCanvasProps {
  graph: TopicMessageFlowLayout
  onNodeSelect: (messageId: string) => void
  className?: string
}

const nodeTypes = {
  [TOPIC_MESSAGE_FLOW_NODE_TYPE]: TopicMessageFlowNode
} satisfies NodeTypes

const defaultFitViewOptions: ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['fitViewOptions'] = {
  padding: 0.18,
  duration: 200
}

const proOptions: ReactFlowProps<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>['proOptions'] = {
  hideAttribution: true
}

function getMiniMapNodeColor(node: TopicMessageFlowNodeModel) {
  const data = node.data

  if (data.role === 'user') return 'var(--color-success)'
  if (data.role === 'assistant') return 'var(--color-info)'
  return 'var(--color-muted)'
}

function getEdgeStyle(edge: TopicMessageFlowEdgeModel): TopicMessageFlowEdgeModel['style'] {
  const data = edge.data

  return {
    stroke: data?.isActivePath
      ? 'var(--color-success)'
      : data?.isInactiveBranch
        ? 'var(--color-gray-400)'
        : 'var(--color-border)',
    strokeWidth: data?.isActivePath ? 2.25 : 1.5,
    strokeDasharray: data?.isActivePath || data?.isSiblingBranch || data?.isInactiveBranch ? '4 4' : undefined,
    ...edge.style
  }
}

const TopicMessageFlowCanvas = ({ className, graph, onNodeSelect }: TopicMessageFlowCanvasProps) => {
  const { t } = useTranslation()
  const hasNodes = graph.nodes.length > 0

  const nodes = useMemo(
    (): TopicMessageFlowNodeModel[] =>
      graph.nodes.map((node) => ({
        ...node,
        type: TOPIC_MESSAGE_FLOW_NODE_TYPE,
        data: {
          ...node.data,
          isActive: node.data.isActive || node.data.messageId === graph.activeNodeId
        }
      })),
    [graph.activeNodeId, graph.nodes]
  )

  const edges = useMemo(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        type: edge.type ?? 'smoothstep',
        animated: edge.animated ?? edge.data?.isActivePath ?? false,
        style: getEdgeStyle(edge)
      })),
    [graph.edges]
  )

  const handleNodeClick = useCallback<NodeMouseHandler<TopicMessageFlowNodeModel>>(
    (_event, node) => {
      onNodeSelect(node.data.messageId)
    },
    [onNodeSelect]
  )

  if (!hasNodes) {
    return (
      <div
        className={cn(
          'relative flex h-full min-h-[320px] items-center justify-center rounded-md border border-border bg-muted/20 text-foreground-muted text-sm',
          className
        )}
        data-testid="topic-message-flow-empty">
        {t('common.no_results')}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative h-full min-h-[320px] overflow-hidden rounded-md border border-border bg-background',
        className
      )}>
      <ReactFlow<TopicMessageFlowNodeModel, TopicMessageFlowEdgeModel>
        colorMode="system"
        deleteKeyCode={null}
        edges={edges}
        edgesFocusable={false}
        elementsSelectable
        fitView
        fitViewOptions={defaultFitViewOptions}
        maxZoom={1.8}
        minZoom={0.2}
        multiSelectionKeyCode={null}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        panOnDrag
        proOptions={proOptions}
        selectionKeyCode={null}
        zoomOnDoubleClick={false}>
        <TopicMessageFlowLegend />
        <MiniMap
          bgColor="var(--color-card)"
          className="overflow-hidden rounded-md border border-border shadow-sm"
          maskColor="color-mix(in srgb, var(--color-background) 72%, transparent)"
          nodeColor={getMiniMapNodeColor}
          pannable
          position="bottom-right"
          zoomable
        />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export default TopicMessageFlowCanvas
