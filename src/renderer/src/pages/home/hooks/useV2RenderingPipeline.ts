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

  const mergedPartsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const next: Record<string, CherryMessagePart[]> = {}
    for (const m of uiMessages) {
      next[m.id] = (m.parts ?? []) as CherryMessagePart[]
    }
    // Streaming overlay, keyed by anchorMessageId. Keep the `id in next`
    // guard so the overlay can only replace parts of a message that already
    // exists in the DB-backed projection — it never adds a list entry (the
    // rendered list stays strictly the uiMessages projection).
    for (const [messageId, parts] of Object.entries(overlay)) {
      if (!(messageId in next) || !parts.length) continue
      next[messageId] = parts
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
  }, [uiMessages, overlay, translationOverlay])

  return {
    projectedMessages,
    mergedPartsMap
  }
}
