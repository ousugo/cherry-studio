# IPC Transport

## What it is

`IpcChatTransport`
(`src/renderer/src/transport/IpcChatTransport.ts`) implements AI SDK's
`ChatTransport<CherryUIMessage>` over Electron IPC. The renderer feeds
it into `useChat({ id: topicId, transport: ... })`; AI SDK calls
`sendMessages` / `reconnectToStream` / `cancel`, the transport relays
each over `window.api.ai.stream*` to Main's `AiStreamManager`.

```
useChat({ id: topicId, transport: new IpcChatTransport(defaultBody) })
   │
   ├─ sendMessages   → window.api.ai.streamOpen   (Ai_Stream_Open)
   ├─ reconnect      → window.api.ai.streamAttach (Ai_Stream_Attach)
   └─ cancel         → window.api.ai.streamAbort  (Ai_Stream_Abort)
```

Per-topic chunks arrive via `onStreamChunk` listeners filtered by
`topicId`.

## Triggers

`sendMessages` distinguishes two triggers:

| Trigger | What it does |
|---|---|
| `submit-message` | Includes `userMessageParts` (the latest message) so Main persists it |
| `regenerate-message` | Sends `parentAnchorId` only; Main re-runs from the existing parent |

Cherry's transport never derives `continue-conversation` from
message-state introspection. Approval-driven resumption goes through the
explicit `Ai_ToolApproval_Respond` IPC handled by
[`useToolApprovalBridge`](./tool-approval.md).

## Dispatch coordinator

`streamDispatchCoordinator` (`src/renderer/src/transport/streamDispatchCoordinator.ts`)
sits between the transport and the IPC call so:

- Each topic has a single in-flight `Ai_Stream_Open` at a time.
- The IPC ack (`userMessageId`, placeholder ids, executionIds) is
  observable to callers that need to join optimistic UI bubbles, rather
  than being thrown away by AI SDK's transport interface.

## Per-execution demux

The chunk stream from Main is keyed by `(topicId, executionId)`.
`buildListenerStream` (called from `sendMessages` and `reconnect`)
maintains a per-execution `ReadableStreamDefaultController` so multi-
model parallel responses render as separate AI SDK messages on the same
topic.

`isPerExecutionOnly(data)` flags chunks that only matter for one
execution (e.g. a model finished while siblings are still streaming).
Consumers that watch topic-level completion (DB refresh, overlay teardown)
ignore those.

## Topic-level subscription

`useTopicStreamStatus(topicId)` reads
`topic.stream.statuses.<topicId>` from the shared cache. The cache is
the cross-window source of truth for:

- `pending` / `streaming` / `awaiting-approval` / `done` / `error` / `aborted`
- broadcast-completion anchor ids

`classifyTurn(status)` decodes the status into the predicates the UI
consumes (`isStreaming`, `isAwaitingApproval`, `isTerminal`, …).

## Where to read more

- Code: `src/renderer/src/transport/`
- Hook glue: `src/renderer/src/hooks/useChatWithHistory.ts`
- Approval bridge: [Tool Approval](./tool-approval.md)
- Main side: [Stream Manager](./stream-manager.md)
