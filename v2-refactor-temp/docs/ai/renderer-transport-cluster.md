# Renderer Transport — Reviewer Cluster

## Scope

| Subpath | Files | Role |
|---|---|---|
| `src/renderer/src/transport/` | `IpcChatTransport.ts`, `streamDispatchCoordinator.ts`, `TopicStreamSubscription.ts` | AI SDK `ChatTransport` adapter + per-execution demux + topic-level subscription |
| `src/renderer/src/hooks/` (transport-adjacent) | `useChatContext.ts`, `useChatWithHistory.ts`, `useTopicStreamSubscription.ts`, `useTopicStreamStatus.ts`, `useTopicMessagesV2.ts`, `useTopicDbRefreshOnTerminal.ts`, `useTopicAwaitingApproval.ts`, `useToolApprovalBridge.ts`, `useExecutionOverlay.ts`, `V2ChatContext.ts`, `ToolApprovalContext.ts` | React hooks that consume the transport |
| Tests | `transport/__tests__/`, `hooks/__tests__/` | Per-file coverage |

## Intent

The renderer was the home of `useChat({ transport: Chat })` and the
hundreds-of-lines `ChatSessionManager` that pulled `streamText` directly.
v2 replaces both with:

1. A thin `IpcChatTransport` that AI SDK's `useChat` plugs into.
2. A coordinator that turns each `sendMessages` into a single
   `Ai_Stream_Open` IPC and observes the ack.
3. Per-topic subscription hooks that read from a topic-level stream
   (not a per-message Chat instance) so the renderer doesn't have to
   own a `Chat` per message.

Architecture: [`docs/references/ai/ipc-transport.md`](../../../docs/references/ai/ipc-transport.md).

## Key changes

### `IpcChatTransport`

`ChatTransport<CherryUIMessage>` implementation. Two methods:

- `sendMessages({ trigger, chatId, messages, ... })` — packages
  `AiStreamOpenRequest`, dispatches via `streamDispatchCoordinator`.
  Trigger is `'submit-message'` (sends `userMessageParts`) or
  `'regenerate-message'` (sends only `parentAnchorId`). Approval-driven
  resumption is NEVER inferred from message-state introspection — it
  goes through the explicit `Ai_ToolApproval_Respond` IPC.
- `reconnectToStream()` — calls `window.api.ai.streamAttach` so the
  renderer can subscribe after route-change / window-mount.

### `streamDispatchCoordinator`

Sits between the transport and the IPC call. Per topic:

- **Single in-flight** — coalesces concurrent `dispatch` calls into
  one IPC.
- **Observable ack** — exposes `userMessageId`, placeholder ids, and
  `executionIds` from the IPC reply (instead of being discarded by
  AI SDK's transport interface).

Consumers (e.g. agent submit) observe the ack via
`coordinator.observeAck(topicId)` so they can join the optimistic UI
bubble to the persisted row.

Commit `a73e580f5 refactor(stream-ack): surface streamOpen ack via a dispatch coordinator`.

### `TopicStreamSubscription`

Subscribes to `Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError`,
filtered by `topicId`. Routes per-execution chunks to a per-execution
`ReadableStreamDefaultController`, so multi-model parallel responses
render as separate AI SDK messages on the same topic. The
`isPerExecutionOnly` helper flags chunks that only matter for one
execution (so topic-level consumers can skip them).

Commit `c6eb28e44 feat(topic-stream-sub): add topic-level subscription with per-execution demux`.

### `useTopicStreamStatus(topicId)`

Reads `topic.stream.statuses.<topicId>` from the shared cache (the
cross-window source of truth for `pending` / `streaming` /
`awaiting-approval` / `done` / `error` / `aborted` + broadcast-completion
anchor ids). `classifyTurn(status)` decodes the status into UI
predicates.

### `useTopicAwaitingApproval(topicId)`

Returns `true` when the topic is paused on approval. Single source of
truth — reads `useTopicStreamStatus(topicId).status` and runs it through
`classifyTurn(...).isAwaitingApproval`. No per-window `partsMap`
introspection (that pattern caused cross-window drift and is what
moved off the renderer in this refactor).

### `useToolApprovalBridge`

Posts the user's decision to Main via `Ai_ToolApproval_Respond`.
Crucially **does not** PATCH `applyApprovalDecisions` itself — Main is
the single writer. See
[`docs/references/ai/tool-approval.md`](../../../docs/references/ai/tool-approval.md).

### `useExecutionOverlay`

Maintains an in-memory overlay (`Record<executionId, CherryUIMessage>`)
fed by `readUIMessageStream` so the UI can render streaming parts
without writing to SWR. On terminal, `useTopicDbRefreshOnTerminal`
revalidates the DB query *first*, *then* the overlay is disposed —
this ordering eliminates the flash between streaming parts and
persisted parts.

Commit `ab9b39fb7 refactor(execution-overlay): replace per-execution Chat with readUIMessageStream readers`.

## Invariants

- `useChat({ id: topicId, transport: IpcChatTransport })` is the only
  consumer pattern. No code should call `window.api.ai.streamOpen`
  directly outside the transport.
- The renderer is never the source of truth for streaming state — every
  status read goes through `useTopicStreamStatus` (shared cache) or the
  per-execution overlay.
- `useToolApprovalBridge` does not write to any local cache; it only
  posts IPC.
- Overlay teardown is monotonic: it's released only after the DB refresh
  resolves (success or failure — see the `.finally` in `V2ChatContent`).

## Validation

- `transport/__tests__/IpcChatTransport.test.ts`
- `transport/__tests__/streamDispatchCoordinator.test.ts`
- `transport/__tests__/TopicStreamSubscription.test.ts`
- `hooks/__tests__/useTopicStreamStatus.test.ts` (if present)
- See also commits `ed905ca45 refactor(v2-chat): broadcast awaiting-approval anchor ids`
  and `3b2fb0752 refactor(v2-chat): consolidate turn-state behind single table-driven classifier`
  for the recent classifier consolidation.

## Follow-ups (out of scope)

- Stream resume across renderer crash (currently scoped to route-change
  reconnects).
- See memory [Consolidate, don't reconcile split-brain state](../../../)
  — the v2 chat consolidation is the application of that principle here.
