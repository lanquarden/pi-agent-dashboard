# Companion repo: pi-dev-worktrees

> Implementation lives in `pi-dev-worktrees` repo:
> `openspec/changes/bash-dispatch-chips/`
>
> Branch: `feature/bash-dispatch-chips`

## Summary

pi-dev-worktrees emits a structured pi event from the `tool_call` handler after routing:

```ts
pi.events.emit("pi-dev-worktrees:bash-dispatch", {
  toolCallId: event.toolCallId,
  llmCommand,
  rtkRewritten,
  rtkCommand: rtkRewritten ? rtkCommand : undefined,
  routing: result.routing,
  hasDevcontainer: state.devcontainer !== undefined,
});
```

## Data path

1. `tool_execution_start` → capture original LLM command in `pendingLlmCommands` Map
2. `tool_call` → after `applyBashIntercept`, emit pi event with dispatch metadata
3. Bridge forwards as `event_forward` automatically (existing mechanism)
4. Client reducer patches tool row `args._dispatch`

## No bridge dependency

Uses `pi.events.emit` — forwarded by bridge's existing flow-event wiring. No `ctx.ui.notify`, no `prompt_request`, no bridge code changes needed.

## Payload contract

```ts
interface BashDispatchPayload {
  toolCallId: string;
  llmCommand: string;
  rtkRewritten: boolean;
  rtkCommand?: string;
  routing: "host" | "container" | "error";
  hasDevcontainer: boolean;
}
```

Both repos define this interface locally — no shared cross-repo package.
