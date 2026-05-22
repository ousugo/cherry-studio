import { dataApiService } from '@data/DataApiService'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowPanel from '../TopicMessageFlowPanel'

const mocks = vi.hoisted(() => ({
  refetchTree: vi.fn(),
  setActiveNode: vi.fn().mockResolvedValue(undefined),
  useQuery: vi.fn(),
  useMutation: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  PageSidePanel: ({
    open,
    header,
    closeLabel,
    contentClassName,
    bodyClassName,
    children
  }: React.PropsWithChildren<{
    open: boolean
    header?: React.ReactNode
    closeLabel?: string
    contentClassName?: string
    bodyClassName?: string
  }>) =>
    open ? (
      <section
        data-testid="page-side-panel"
        data-body-class-name={bodyClassName}
        data-content-class-name={contentClassName}>
        <div>{header}</div>
        <button type="button" aria-label={closeLabel} />
        {children}
      </section>
    ) : null
}))

vi.mock('@renderer/components/chat/messages/flow', () => ({
  buildTopicMessageFlowGraph: vi.fn((tree) => ({
    activeNodeId: tree.activeNodeId,
    edges: [],
    nodes: tree.nodes.map((node: { id: string }) => ({
      id: node.id,
      data: { messageId: node.id },
      position: { x: 0, y: 0 }
    })),
    stats: {
      activePathLength: tree.nodes.length,
      branchCount: 2,
      nodeCount: tree.nodes.length
    }
  })),
  layoutTopicMessageFlowGraph: vi.fn((graph) => graph),
  TopicMessageFlowCanvas: ({ onNodeSelect }: { onNodeSelect: (messageId: string) => void }) => (
    <button type="button" data-testid="topic-message-flow-canvas" onClick={() => onNodeSelect('message-1')}>
      flow canvas
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('TopicMessageFlowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'active-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })
    mocks.useMutation.mockReturnValue({
      trigger: mocks.setActiveNode
    })
    vi.mocked(dataApiService.get).mockResolvedValue([{ id: 'message-1' }, { id: 'leaf-1' }])
  })

  it('uses the public page side panel and fetches the topic tree only while open', () => {
    render(<TopicMessageFlowPanel open={true} onClose={vi.fn()} topicId="topic-1" topicName="AI 聊天应用技术选型" />)

    expect(screen.getByTestId('page-side-panel')).toHaveAttribute(
      'data-content-class-name',
      'w-[min(760px,calc(100vw-24px))]'
    )
    expect(screen.getByTestId('page-side-panel')).toHaveAttribute(
      'data-body-class-name',
      'flex min-h-0 flex-col space-y-0 overflow-hidden p-0'
    )
    expect(screen.getByText('chat.message.flow.title')).toBeInTheDocument()
    expect(screen.getByText('AI 聊天应用技术选型')).toBeInTheDocument()
    expect(screen.getByText('2 chat.message.flow.branches')).toBeInTheDocument()
    expect(screen.getByText('1 chat.message.flow.nodes')).toBeInTheDocument()
    expect(screen.getByLabelText('common.close')).toBeInTheDocument()
    expect(mocks.useQuery).toHaveBeenCalledWith('/topics/:topicId/tree', {
      enabled: true,
      params: { topicId: 'topic-1' },
      query: { depth: -1 }
    })
  })

  it('sets the active branch to the latest leaf passing through the selected node', async () => {
    render(<TopicMessageFlowPanel open={true} onClose={vi.fn()} topicId="topic-1" />)

    fireEvent.click(screen.getByTestId('topic-message-flow-canvas'))

    await waitFor(() => {
      expect(dataApiService.get).toHaveBeenCalledWith('/topics/topic-1/path', {
        query: { nodeId: 'message-1' }
      })
    })
    expect(mocks.setActiveNode).toHaveBeenCalledWith({
      body: { nodeId: 'leaf-1' },
      params: { id: 'topic-1' }
    })
    expect(mocks.refetchTree).toHaveBeenCalled()
  })

  it('does not write when selecting the current active node', async () => {
    mocks.useQuery.mockReturnValue({
      data: {
        activeNodeId: 'message-1',
        nodes: [
          {
            id: 'message-1',
            parentId: null,
            role: 'user',
            preview: 'Hello',
            modelId: null,
            status: 'success',
            createdAt: '2026-05-22T00:00:00.000Z',
            hasChildren: false
          }
        ],
        siblingsGroups: []
      },
      error: undefined,
      isLoading: false,
      refetch: mocks.refetchTree
    })

    render(<TopicMessageFlowPanel open={true} onClose={vi.fn()} topicId="topic-1" />)

    fireEvent.click(screen.getByTestId('topic-message-flow-canvas'))

    await Promise.resolve()

    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
  })
})
