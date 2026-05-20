/**
 * Agent session history data source — returns CherryUIMessage[] for useChatWithHistory.
 *
 * Backed by DataApi (`/sessions/:sessionId/messages`) with cursor-based
 * infinite pagination so chat-style transcripts of arbitrary length load
 * incrementally as the virtual list scrolls up. Reads go through SWR's
 * shared cache (dedup, revalidation, cross-window consistency).
 */

import { useInfiniteFlatItems, useInfiniteQuery, useMutation } from '@renderer/data/hooks/useDataApi'
import type { AgentSessionMessageEntity } from '@shared/data/types/agent'
import type { CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useMemo } from 'react'

const PAGE_SIZE = 50

export function toAgentSessionUIMessage(row: AgentSessionMessageEntity): CherryUIMessage {
  const metadata: CherryUIMessage['metadata'] = {}
  if (row.createdAt) metadata.createdAt = row.createdAt
  metadata.status = row.status
  if (row.modelId) metadata.modelId = row.modelId
  if (row.modelSnapshot) metadata.modelSnapshot = row.modelSnapshot
  if (row.traceId) metadata.traceId = row.traceId
  if (row.stats) metadata.stats = row.stats

  return {
    id: row.id,
    role: row.role,
    parts: row.data.parts ?? [],
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  } as CherryUIMessage
}

export function useAgentSessionParts(sessionId: string) {
  const sessionMessagesCachePath = `/sessions/${sessionId}/messages` as const
  const { pages, isLoading, hasNext, loadNext, mutate } = useInfiniteQuery('/sessions/:sessionId/messages', {
    params: { sessionId },
    limit: PAGE_SIZE,
    enabled: !!sessionId
  })
  const { trigger: deleteMessageTrigger } = useMutation('DELETE', '/sessions/:sessionId/messages/:messageId', {
    refresh: [sessionMessagesCachePath]
  })

  // Server returns each page newest-first (DESC) and the cursor walks older.
  // MessageVirtualList expects chronological-asc (oldest first), so reverse both
  // axes: oldest page first, and within each page reverse to ASC.
  const rows = useInfiniteFlatItems(pages, { reversePages: true, reverseItems: true })

  const messages = useMemo<CherryUIMessage[]>(() => {
    return rows.map(toAgentSessionUIMessage)
  }, [rows])

  const refreshMessages = useCallback(async (): Promise<CherryUIMessage[]> => {
    const refreshedPages = await mutate()
    const flat: AgentSessionMessageEntity[] = []
    if (refreshedPages) {
      for (let i = refreshedPages.length - 1; i >= 0; i--) {
        const page = refreshedPages[i]
        for (let j = page.items.length - 1; j >= 0; j--) flat.push(page.items[j])
      }
    }
    return flat.map(toAgentSessionUIMessage)
  }, [mutate])

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      await deleteMessageTrigger({ params: { sessionId, messageId } })
    },
    [deleteMessageTrigger, sessionId]
  )

  return {
    messages,
    isLoading,
    hasOlder: hasNext,
    loadOlder: loadNext,
    refresh: refreshMessages,
    deleteMessage
  }
}
