/**
 * Topic-level stream subscription with per-execution demux + ref-counted
 * attach/detach.
 *
 * Why this exists: Main's stream listener is keyed `(window, topicId)` and
 * `AiStreamManager.detach` removes the whole topic listener — there is no
 * per-execution detach. If every execution managed its own
 * `streamAttach`/`streamDetach`, one execution ending would tear down the
 * shared listener (and, when `backgroundMode === 'abort'` and it was the
 * last listener, abort the still-running generation). So attach/detach must
 * be ref-counted at the topic level, with a single chunk listener demuxing
 * by `executionId` into per-execution branch streams.
 *
 * Cancellation layering (do not conflate): this owns only the renderer-local
 * subscription lifecycle — attach/detach + closing branch streams. That is
 * equivalent to today's `streamDetach` (renderer stops listening; Main keeps
 * generating; other windows keep observing). Generation abort (stopping the
 * LLM) is always Main's job, triggered by the user via
 * `useChatWithHistory.stop` → trigger Chat → `streamAbort`. This layer never
 * aborts generation.
 */
import { loggerService } from '@logger'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

const logger = loggerService.withContext('TopicStreamSubscription')

/** Per-execution terminal classification, for `onFinish` in the reader layer. */
export interface ExecutionTerminal {
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (executionId: UniqueModelId, terminal: ExecutionTerminal) => void

interface Branch {
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  closed: boolean
}

function createBranch(): Branch {
  const branch: Branch = { stream: undefined as never, controller: null, closed: false }
  branch.stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      branch.controller = controller
    },
    cancel() {
      branch.closed = true
    }
  })
  return branch
}

export class TopicStreamSubscription {
  readonly #topicId: string
  readonly #branches = new Map<UniqueModelId, Branch>()
  readonly #terminalListeners = new Set<TerminalListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #disposed = false

  constructor(topicId: string) {
    this.#topicId = topicId
  }

  /**
   * Get (creating if needed) the branch `ReadableStream` for an execution.
   * Chunks that arrived before this call are already queued in the stream's
   * internal buffer (the controller is created synchronously), so a late
   * reader never loses replayed/early chunks. Also ensures the topic is
   * attached.
   */
  register(executionId: UniqueModelId): ReadableStream<UIMessageChunk> {
    const branch = this.#getOrCreateBranch(executionId)
    void this.#ensureAttached()
    return branch.stream
  }

  /**
   * The reader for this execution is gone. Closes only this branch — never
   * detaches the topic. When the last branch unregisters, the topic detaches
   * (deferred a tick so a transient `activeExecutions` flicker doesn't
   * detach→reattach and momentarily drop Main's last listener).
   */
  unregister(executionId: UniqueModelId): void {
    const branch = this.#branches.get(executionId)
    if (!branch) return
    this.#closeBranch(branch)
    this.#branches.delete(executionId)
    if (this.#branches.size === 0 && this.#attached && !this.#disposed) {
      queueMicrotask(() => {
        if (this.#branches.size === 0 && this.#attached && !this.#disposed) this.#detach()
      })
    }
  }

  /** Subscribe to per-execution terminal events. Returns an unsubscribe fn. */
  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    return () => this.#terminalListeners.delete(listener)
  }

  /** Tear down everything: detach the topic, drop IPC listeners, close all branches. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminalListeners.clear()
    if (this.#attached) void window.api.ai.streamDetach({ topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
    for (const unsub of this.#ipcUnsubs) unsub()
    this.#ipcUnsubs = []
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreateBranch(executionId: UniqueModelId): Branch {
    let branch = this.#branches.get(executionId)
    if (!branch) {
      branch = createBranch()
      this.#branches.set(executionId, branch)
    }
    return branch
  }

  #closeBranch(branch: Branch): void {
    if (branch.closed) return
    branch.closed = true
    try {
      branch.controller?.close()
    } catch {
      // already closed/errored — fine
    }
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (payload.topicId !== this.#topicId) return
    const executionId = payload.executionId
    if (!executionId) {
      // Every chat chunk is tagged with executionId(=modelId) by Main. A
      // missing one is unexpected; if there is exactly one branch, route to
      // it (defensive), else drop with a warning.
      if (this.#branches.size === 1) {
        const only = this.#branches.values().next().value as Branch
        if (!only.closed) only.controller?.enqueue(payload.chunk)
      } else {
        logger.warn('chunk without executionId dropped', { topicId: this.#topicId })
      }
      return
    }
    const branch = this.#getOrCreateBranch(executionId)
    if (!branch.closed) branch.controller?.enqueue(payload.chunk)
  }

  #emitTerminal(executionId: UniqueModelId, terminal: ExecutionTerminal): void {
    const branch = this.#branches.get(executionId)
    if (branch) this.#closeBranch(branch)
    for (const listener of this.#terminalListeners) {
      try {
        listener(executionId, terminal)
      } catch (err) {
        logger.warn('terminal listener threw', { topicId: this.#topicId, err })
      }
    }
  }

  #terminateAll(terminal: ExecutionTerminal): void {
    for (const executionId of [...this.#branches.keys()]) this.#emitTerminal(executionId, terminal)
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      window.api.ai.onStreamChunk((data) => this.#routeChunk(data)),
      window.api.ai.onStreamDone((data) => {
        if (data.topicId !== this.#topicId) return
        const terminal: ExecutionTerminal = { isAbort: data.status === 'paused', isError: false }
        if (data.executionId) this.#emitTerminal(data.executionId, terminal)
        if (data.isTopicDone || !data.executionId) this.#terminateAll(terminal)
      }),
      window.api.ai.onStreamError((data) => {
        if (data.topicId !== this.#topicId) return
        const terminal: ExecutionTerminal = { isAbort: false, isError: true }
        if (data.executionId) this.#emitTerminal(data.executionId, terminal)
        if (data.isTopicDone || !data.executionId) this.#terminateAll(terminal)
      })
    )
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attached || this.#attachInFlight || this.#disposed) return this.#attachInFlight ?? undefined
    // Register IPC listeners BEFORE attaching so live chunks Main emits right
    // after registering its listener are not missed.
    this.#setupIpcListeners()
    this.#attachInFlight = (async () => {
      try {
        const res = await window.api.ai.streamAttach({ topicId: this.#topicId })
        if (this.#disposed) return
        this.#attached = true
        switch (res.status) {
          case 'attached':
            for (const payload of res.bufferedChunks) this.#routeChunk(payload)
            break
          case 'not-found':
            // No live stream — close branches so readers end immediately.
            this.#terminateAll({ isAbort: false, isError: false })
            break
          case 'done':
            this.#terminateAll({ isAbort: false, isError: false })
            break
          case 'paused':
            this.#terminateAll({ isAbort: true, isError: false })
            break
          case 'error':
            this.#terminateAll({ isAbort: false, isError: true })
            break
        }
      } catch (err) {
        logger.warn('streamAttach failed', { topicId: this.#topicId, err })
      } finally {
        this.#attachInFlight = null
      }
    })()
    return this.#attachInFlight
  }

  #detach(): void {
    if (!this.#attached) return
    void window.api.ai.streamDetach({ topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
  }
}
