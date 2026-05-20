# Trace

## What's instrumented

Every AI SDK call run through Cherry produces an OpenTelemetry span
tree:

```
chat.turn                                      (root, created by context provider)
├── ai.streamText                              (AI SDK auto)
│   ├── ai.streamText.doStream                 (AI SDK auto)
│   ├── ai.toolCall (per tool invocation)      (AI SDK auto)
│   └── ai.streamText.<step>                   (AI SDK auto)
└── attributes: topicId, modelName, …          (set by AdapterTracer)
```

AI SDK's `experimental_telemetry` produces the inner spans; Cherry wraps
the root span so it lands in the same persistence path.

## AdapterTracer

`src/main/ai/trace/adapterTracer.ts` wraps the OTel `Tracer` returned
by the global provider. On every `startSpan` / `startActiveSpan` it:

1. Patches `span.end()` to also call `AiSdkSpanAdapter.convertToSpanEntity(...)`
   and hand the result to `SpanCacheService.saveEntity(...)`.
2. Stamps `trace.topicId` and `trace.modelName` so spans are queryable
   per topic in the dev-tools UI.

Two callers wrap with `AdapterTracer`:

- `buildTelemetry` (`agent/params/buildTelemetry.ts`) — passed to AI
  SDK as `experimental_telemetry.tracer`. Captures every AI SDK auto-span.
- Chat context providers — wrap the root span (`chat.turn`) so the root
  also persists. Without this, only AI SDK children would land in cache.

## AiSdkSpanAdapter

`src/main/ai/trace/aiSdkSpanAdapter.ts` converts an OTel span into the
shape the dev-tools UI consumes:

- Reads span name, attributes, events, status, links.
- Recovers AI SDK's hierarchical attribute conventions:
  `ai.xxx` is a level, `ai.xxx.yyy` is a sub-level under it.
- Normalises usage attributes (`ai.usage.input_tokens` /
  `output_tokens` / `reasoning_tokens` / …) across providers.

Test coverage: `src/main/ai/trace/__tests__/aiSdkSpanAdapter.test.ts`.

## Where it shows up in the UI

Dev mode only. The dev-tools span viewer reads from `SpanCacheService`
and renders the per-topic tree. Disabled in production builds — the
adapter tracer is still attached, but the cache is short-circuited.

## Where to read more

- Code: `src/main/ai/trace/`
- Span persistence: `src/main/services/spanCache/SpanCacheService.ts`
- AI SDK telemetry docs: https://ai-sdk.dev/docs/reference/ai-sdk-core/telemetry
