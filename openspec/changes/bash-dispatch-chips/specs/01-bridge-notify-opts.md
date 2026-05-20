# Spec: Bridge notify opts alignment

> **Status**: Implemented. Preserved for future use. NOT used by bash-dispatch-chips feature (which uses `event_forward` instead).

## File
`packages/extension/src/bridge.ts`

## Change
Align `ctx.ui.notify` patch with `select`/`input`/`confirm`/`editor`/`multiselect` — all accept `opts` and thread `toolCallId` through `buildMeta`.

## New signature
```ts
(ctx.ui as any).notify = (
  message: string,
  levelOrOpts?: string | { toolCallId?: string; level?: string; method?: string; props?: Record<string, unknown> },
  _opts?: never,
) => { ... };
```

## Backward compatibility
All existing `ctx.ui.notify(message)` and `ctx.ui.notify(message, level)` callers work without change.

## Why preserved
General-purpose capability for future plugins that need to emit structured prompt_request messages via `ctx.ui.notify`. The bash-dispatch-chips feature pivoted to `event_forward` (simpler, zero bridge dependency) but notify opts remains useful for interactive-renderer use cases.
