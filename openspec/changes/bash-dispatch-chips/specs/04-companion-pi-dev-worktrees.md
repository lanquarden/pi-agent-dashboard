# Companion repo: pi-dev-worktrees

> The implementation tasks and spec for the extension side live in the `pi-dev-worktrees` repo:
> `openspec/changes/bash-dispatch-chips/`
>
> Branch: `feature/bash-dispatch-chips`

## Summary of what pi-dev-worktrees implements

See `pi-dev-worktrees/openspec/changes/bash-dispatch-chips/specs/01-capture-and-emit.md` for full detail.

1. **`tool_execution_start`**: store `event.args.command` in `pendingLlmCommands` Map keyed by `toolCallId`
2. **`tool_call`**: after `applyBashIntercept`, call `ctx.ui.notify(llmCommand, { toolCallId, method: "bash-dispatch", props: BashDispatchProps })`
3. **No `tool_result` changes** — suppression mechanism auto-dismisses on completion

## Prerequisite

The bridge opts extension (`specs/01-bridge-notify-opts.md` in this repo) must land first — or simultaneously — for the `method` and `props` fields to be forwarded correctly. In TUI context (no bridge) the extra opts are silently ignored.

## Payload contract

```ts
interface BashDispatchProps {
  llmCommand: string;        // original LLM command (pre-RTK)
  rtkRewritten: boolean;
  rtkCommand?: string;       // present iff rtkRewritten
  routing: "host" | "container" | "error";
  hasDevcontainer: boolean;  // whether devcontainer is configured in session
}
```

Both repos define this interface locally — no shared cross-repo package.
