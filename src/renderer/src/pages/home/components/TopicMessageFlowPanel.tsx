import { Button, PageSidePanel, Tooltip } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import {
  buildTopicMessageFlowGraph,
  layoutTopicMessageFlowGraph,
  TopicMessageFlowCanvas
} from '@renderer/components/chat/messages/flow'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { Message as DbMessage, TreeResponse } from '@shared/data/types/message'
import { GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onClose: () => void
  topicId: string
  topicName?: string
}

const logger = loggerService.withContext('TopicMessageFlowPanel')

const emptyTree: TreeResponse = {
  activeNodeId: null,
  nodes: [],
  siblingsGroups: []
}

const TopicMessageFlowPanel: FC<Props> = ({ open, onClose, topicId, topicName }) => {
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const treeCachePath = `/topics/${topicId}/tree` as const
  const { data, error, isLoading, refetch } = useQuery('/topics/:topicId/tree', {
    enabled: open,
    params: { topicId },
    query: { depth: -1 }
  })
  const { trigger: setActiveNode } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: [messagesCachePath, treeCachePath]
  })

  const graph = useMemo(() => layoutTopicMessageFlowGraph(buildTopicMessageFlowGraph(data ?? emptyTree)), [data])

  const handleClose = useCallback(() => {
    setIsFullscreen(false)
    onClose()
  }, [onClose])

  const handleNodeSelect = useCallback(
    async (messageId: string) => {
      if (messageId === graph.activeNodeId) return

      let leafId = messageId
      try {
        const path = (await dataApiService.get(`/topics/${topicId}/path`, {
          query: { nodeId: messageId }
        })) as DbMessage[]
        if (path.length > 0) {
          leafId = path[path.length - 1].id
        }
        await setActiveNode({
          params: { id: topicId },
          body: { nodeId: leafId }
        })
        await refetch()
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to set active branch from topic flow', err as Error)
        window.toast.error(t('common.error'))
      }
    },
    [graph.activeNodeId, refetch, setActiveNode, t, topicId]
  )

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
      <GitBranch size={16} className="shrink-0 text-foreground-muted" />
      <span className="shrink-0 font-semibold text-foreground">
        {t('chat.message.flow.title', { defaultValue: 'Branch Management' })}
      </span>
      {topicName && (
        <>
          <span className="shrink-0 text-foreground-muted">·</span>
          <span className="min-w-0 max-w-[220px] truncate text-foreground-muted">{topicName}</span>
        </>
      )}
      <span className="shrink-0 text-foreground-muted">·</span>
      <span className="shrink-0 text-foreground-muted">
        {graph.stats.branchCount} {t('chat.message.flow.branches', { defaultValue: 'branches' })}
      </span>
      <span className="shrink-0 text-foreground-muted">·</span>
      <span className="shrink-0 text-foreground-muted">
        {graph.stats.nodeCount} {t('chat.message.flow.nodes', { defaultValue: 'nodes' })}
      </span>
      <Tooltip
        content={t(isFullscreen ? 'common.minimize' : 'common.maximize')}
        delay={800}
        classNames={{ placeholder: 'ml-auto shrink-0' }}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(isFullscreen ? 'common.minimize' : 'common.maximize')}
          aria-pressed={isFullscreen}
          className="text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
          onClick={() => setIsFullscreen((current) => !current)}>
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Button>
      </Tooltip>
    </div>
  )

  return (
    <PageSidePanel
      open={open}
      onClose={handleClose}
      header={header}
      closeLabel={t('common.close')}
      contentClassName={
        isFullscreen
          ? 'top-0 right-0 bottom-0 left-0 w-auto rounded-none border-y-0 border-r-0'
          : 'w-[min(760px,calc(100vw-24px))]'
      }
      bodyClassName="flex min-h-0 flex-col space-y-0 overflow-hidden p-0">
      {error ? (
        <div className="flex h-full min-h-80 items-center justify-center text-destructive text-sm" role="alert">
          {t('common.error')}
        </div>
      ) : isLoading ? (
        <div className="flex h-full min-h-80 items-center justify-center text-foreground-muted text-sm">
          {t('common.loading')}
        </div>
      ) : (
        <TopicMessageFlowCanvas
          className="h-full min-h-0 rounded-none border-0"
          graph={graph}
          onNodeSelect={handleNodeSelect}
        />
      )}
    </PageSidePanel>
  )
}

export default TopicMessageFlowPanel
