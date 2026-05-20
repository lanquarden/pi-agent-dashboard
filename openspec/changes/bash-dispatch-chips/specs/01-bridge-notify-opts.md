# Spec: Bridge notify opts alignment

## File
`packages/extension/src/bridge.ts`

## Change
Align `ctx.ui.notify` patch with `select`/`input`/`confirm`/`editor`/`multiselect` — all of which already accept `opts` and thread `toolCallId` through `buildMeta`.

## Current behaviour
```ts
(ctx.ui as any).notify = (message: string, level?: string) => {
  originalNotify?.(message, level);
  connection.send({
    type: "prompt_request",
    sessionId,
    promptId: crypto.randomUUID(),
    prompt: { question: message, type: "notify" },
    component: { type: "notify", props: { message, level } },
    placement: "inline",
  });
};
```

`level` is positional only. No `toolCallId` support. `prompt.type` and `component.type` are always `"notify"`, which drives renderer lookup — no way for a caller to emit a custom method.

## New signature
```ts
(ctx.ui as any).notify = (
  message: string,
  levelOrOpts?: string | { toolCallId?: string; level?: string; method?: string; props?: Record<string, unknown> },
  _opts?: never,  // reserved; absorbs positional 3rd arg for future compat
) => {
  const level =
    typeof levelOrOpts === "string" ? levelOrOpts : (levelOrOpts?.level ?? undefined);
  const toolCallId =
    typeof levelOrOpts === "object" ? levelOrOpts?.toolCallId : undefined;
  const method =
    (typeof levelOrOpts === "object" ? levelOrOpts?.method : undefined) ?? "notify";
  const extraProps =
    typeof levelOrOpts === "object" ? (levelOrOpts?.props ?? {}) : {};

  originalNotify?.(message, level);
  connection.send({
    type: "prompt_request" as any,
    sessionId,
    promptId: crypto.randomUUID(),
    prompt: { question: message, type: method, metadata: buildMeta({ toolCallId }) },
    component: { type: method, props: { message, level, ...extraProps } },
    placement: "inline",
  });
};
```

**`opts.props`**: arbitrary extra fields merged into `component.props`. Allows callers to pass structured payload (e.g. `BashDispatchProps`) through the bridge without modifying the bridge for each new use case.

## Rules
- `levelOrOpts` as `string` → backward-compat, same as today; `prompt.type` stays `"notify"`, no `toolCallId`
- `levelOrOpts` as object → reads `.level`, `.toolCallId`, `.method`
- `method` defaults to `"notify"` — sets both `prompt.type` and `component.type`, which drives `getInteractiveRenderer` lookup in the client
- `toolCallId` threaded through `buildMeta` into `prompt.metadata.toolCallId` — same field `useMessageHandler` already reads for the suppression mechanism
- `originalNotify` still called with `(message, level)` regardless of opts
- When `toolCallId` is set, the `prompt_request` is paired with the bash tool card: the suppression mechanism (`findActiveInteractiveToolResultIds`) hides the bare tool card while the interactiveUi row is `pending`; on tool completion the prompt is auto-resolved and the standard card reappears in history

## Backward compatibility
All existing `ctx.ui.notify(message)` and `ctx.ui.notify(message, level)` callers work without change.

## Test: `packages/extension/src/__tests__/bridge-notify-opts.test.ts`
- `notify(message, level)` → `prompt_request` with `prompt.type = "notify"`, `component.type = "notify"`, no `metadata`
- `notify(message, { level, toolCallId, method })` → `prompt_request` with `prompt.type = method`, `component.type = method`, `prompt.metadata.toolCallId = toolCallId`
- `notify(message, { toolCallId })` only → method defaults to `"notify"`, metadata carries toolCallId
