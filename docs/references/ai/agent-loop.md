# Agent Loop

## What it is

`Agent` (`src/main/ai/runtime/aiSdk/Agent.ts`) wraps AI SDK's
`createAgent(...).stream()` with two things AI SDK doesn't give you out of
the box:

- a queue (`PendingMessageQueue`) the rest of Main can push messages into
  *while a stream is in flight*, drained both mid-flight (via `prepareStep`)
  and at the tail of each stream;
- a `composeHooks` pipeline that folds N independent hook contributors
  (per-feature plugins, AiService analytics, internal observers) into a
  single `AgentLoopHooks` object with deterministic ordering.

`Agent` does not know about topics, IPC, persistence, or multi-model
fan-out. Those concerns live in the stream manager — see
[Stream Manager](./stream-manager.md).

## API

```ts
const agent = new Agent({
  providerId, providerSettings, modelId,
  plugins, tools, system, options,
  hookParts,          // RequestFeature contributions
  pendingMessages,    // session-isolated queue, optional
  messageId           // stable id for the first emitted UIMessage
})

const stream: ReadableStream<UIMessageChunk> = agent.stream(initialMessages)
// or
const result = await agent.generate(messages)   // non-streaming

// internal observers can also register on the agent:
const dispose = agent.on('onStepFinish', step => { … })
```

`stream()` and `generate()` share the underlying agent — only the AI SDK
call differs. Future `runToCompletion()` / `toTool()` are placeholders;
they don't ship in this PR.

## Hooks model

```ts
interface AgentLoopHooks {
  onStart?: () => Promise<void> | void
  prepareStep?: PrepareStepFunction             // chained
  onStepFinish?: (step) => Promise<void> | void // void-fan-out
  onToolExecutionStart?: (event) => Promise<void> | void
  onToolExecutionEnd?: (event) => Promise<void> | void
  onFinish?: () => Promise<void> | void
  onError?: (ctx) => 'retry' | 'abort'
}
```

Hook contributions come from three sources, all folded by `composeHooks`:

1. **Internal observers** (`Agent.on(key, fn)`) — `attachUsageObserver`
   (injects `message-metadata` chunks carrying token usage),
   `attachSteeringObserver` (drains `pendingMessages` mid-flight via
   `prepareStep`).
2. **Feature contributions** (`hookParts` param) — each `RequestFeature`'s
   `contributeHooks(scope)` (see [Params Pipeline](./params-pipeline.md)).
3. **Caller hooks** — `AiService` adds analytics / root-span lifecycle.

Composition rules per hook key:

| key | rule |
|---|---|
| `onStart`, `onFinish`, `onStepFinish`, `onToolExecutionStart/End` | `chainVoid` — sequential `for`-loop await; per-hook throws logged and swallowed, chain continues |
| `prepareStep` | chained — each invocation receives the previous return value |
| `onError` | every handler invoked sequentially; any `'retry'` makes the result `'retry'`; default `abort` |

All void hooks share the same `chainVoid` helper in `composeHooks.ts` —
there is no `Promise.allSettled` / parallel path.

Tool execution events (`onToolExecutionStart/End`) are emitted by a
wrapper around each tool's `execute`. AI SDK v6 doesn't expose them
directly; v7 introduces `experimental_onToolExecutionStart/End` on the
Agent layer with the same shape — when v7 lands the wrapper is removed
and hook signatures stay stable.

## Pending messages

`PendingMessageQueue` (`src/main/ai/runtime/aiSdk/loop/PendingMessageQueue.ts`) is a
session-isolated FIFO. The stream manager pushes onto it from
`Ai_Stream_Open` IPC when a topic already has a live stream
(**inject** path). Generic AI SDK agent loops drain it in two places:

1. **Mid-flight** — `attachSteeringObserver` registers on `prepareStep`,
   appends queued messages to the message list AI SDK is about to send.
2. **Tail recheck** — after `agent.stream()` settles, if the queue is
   non-empty the loop re-invokes `agent.stream()` with the drained
   messages appended. This catches the race where the user injects after
   AI SDK's last `prepareStep` fired.

Agent-session runtimes may own their own long-lived input queue. In that
case the stream manager still uses the same live-inject path, but the
runtime consumes the pending messages instead of the generic agent loop.

## Error and abort

- `signal.aborted` is honoured throughout; aborted streams settle with
  the accumulated chunks already broadcast.
- Thrown errors are caught and routed through `onError`. Returning
  `'retry'` is reserved for a future implementation — today the loop
  logs and aborts.
- The writer is settled exactly once via the `then`/`catch` of the
  internal IIFE — listeners never see a half-closed stream.

## Where to read more

- Code: `src/main/ai/runtime/aiSdk/`
- Tests: `src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts`
- Stream manager integration: [Stream Manager](./stream-manager.md)
- Hook contributors: [Params Pipeline](./params-pipeline.md)
