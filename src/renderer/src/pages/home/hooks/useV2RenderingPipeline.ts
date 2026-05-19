/**
 * V2 chat rendering pipeline.
 *
 * Projects DB-backed `uiMessages` into renderer `Message[]` and layers
 * per-execution streaming parts on top of the static `partsMap`. Lives
 * apart from `V2ChatContent.tsx` because these memos have nothing to do
 * with mutations / send flow — keeping them separate means each file
 * reads as "one concern".
 *
 * Ownership:
 *   - `uiMessages` — input (DB truth from `useTopicMessagesV2`)
 *   - `activeExecutions` — input (SharedCache from `useChatWithHistory`)
 *   - `executionMessagesById` — local state populated by mounted
 *     `ExecutionStreamCollector` components via the returned handlers
 *   - `projectedMessages` / `mergedPartsMap` — outputs consumed by
 *     `Messages` / `PartsProvider`
 */
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useMemo, useRef } from 'react'

import type { TranslationOverlayEntry } from '../Messages/Blocks/V2Contexts'
import { uiToMessage } from '../uiToMessage'

export interface V2RenderingPipeline {
  projectedMessages: Message[]
  mergedPartsMap: Record<string, CherryMessagePart[]>
}

export function useV2RenderingPipeline(
  uiMessages: CherryUIMessage[],
  topic: Topic,
  overlay: Record<string, CherryMessagePart[]> = {},
  translationOverlay: Record<string, TranslationOverlayEntry> = {}
): V2RenderingPipeline {
  const { assistant, model } = useAssistant(topic.assistantId)

  const fallbackSnapshot = useMemo<ModelSnapshot | undefined>(() => {
    if (!model) return undefined
    const { providerId, modelId } = parseUniqueModelId(model.id)
    return {
      id: modelId,
      name: model.name,
      provider: providerId,
      ...(model.group && { group: model.group })
    }
  }, [model])

  const lastUserIdInBase = useMemo(() => {
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      if (uiMessages[i].role === 'user') return uiMessages[i].id
    }
    return undefined
  }, [uiMessages])

  const projectionCacheRef = useRef<{ sig: string; cache: WeakMap<CherryUIMessage, Message> } | null>(null)

  const projectedMessages = useMemo<Message[]>(() => {
    const ctx = {
      assistantId: assistant?.id ?? topic.assistantId,
      topicId: topic.id,
      askIdFallback: lastUserIdInBase,
      modelFallback: fallbackSnapshot
    }
    const sig = `${ctx.assistantId}|${ctx.topicId}|${ctx.askIdFallback ?? ''}|${ctx.modelFallback?.id ?? ''}|${ctx.modelFallback?.provider ?? ''}`
    if (projectionCacheRef.current?.sig !== sig) {
      projectionCacheRef.current = { sig, cache: new WeakMap() }
    }
    const cache = projectionCacheRef.current.cache
    return uiMessages.map((m) => {
      const cached = cache.get(m)
      if (cached) return cached
      const result = uiToMessage(m, ctx)
      cache.set(m, result)
      return result
    })
  }, [uiMessages, assistant?.id, topic.assistantId, topic.id, lastUserIdInBase, fallbackSnapshot])

  const lastGoodOverlayRef = useRef<{ topicId: string; map: Record<string, CherryMessagePart[]> }>({
    topicId: topic.id,
    map: {}
  })

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    // A DB row is the final truth for its id once it is terminal AND has
    // content — this is the gate that lets the overlay hand off to DB
    // without a flash. `metadata.status` is projected from the persisted
    // row by `toUIMessage`.
    const finalIds = new Set<string>()
    for (const m of uiMessages) {
      next[m.id] = (m.parts ?? []) as CherryMessagePart[]
      const status = m.metadata?.status
      if ((status === 'success' || status === 'paused' || status === 'error') && (m.parts?.length ?? 0) > 0) {
        finalIds.add(m.id)
      }
    }

    if (lastGoodOverlayRef.current.topicId !== topic.id) {
      lastGoodOverlayRef.current = { topicId: topic.id, map: {} }
    }
    const lastGood = lastGoodOverlayRef.current.map

    // Streaming overlay, keyed by anchorMessageId. The `id in next` guard
    // keeps the rendered list strictly the uiMessages projection (overlay
    // only ever replaces an existing message's parts, never appends).
    //
    // Monotonic hand-off: while the DB row is NOT yet final, the live
    // (or last non-empty) streamed parts win; once the DB row is final the
    // DB parts win and the retained overlay is dropped. This makes content
    // never regress — covering the window between `disposeOverlay` and the
    // terminal-status SWR refresh, and remount mid-stream.
    for (const messageId of Object.keys(next)) {
      if (finalIds.has(messageId)) {
        delete lastGood[messageId]
        continue
      }
      const live = overlay[messageId]
      if (live?.length) {
        lastGood[messageId] = live
        next[messageId] = live
      } else if (lastGood[messageId]?.length) {
        next[messageId] = lastGood[messageId]
      }
    }

    for (const [messageId, entry] of Object.entries(translationOverlay)) {
      const existing = next[messageId]
      if (!existing) continue
      const baseParts = existing.filter((p) => p.type !== 'data-translation')
      const translationPart: CherryMessagePart = {
        type: 'data-translation',
        data: {
          content: entry.content,
          targetLanguage: entry.targetLanguage,
          ...(entry.sourceLanguage && { sourceLanguage: entry.sourceLanguage })
        }
      }
      next[messageId] = [...baseParts, translationPart]
    }
    return next
  }, [uiMessages, overlay, translationOverlay, topic.id])

  return {
    projectedMessages,
    mergedPartsMap
  }
}
