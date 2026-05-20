## Context

### Event ordering in pi (confirmed)

```
tool_execution_start  ← args = original LLM command → forwarded to dashboard
tool_call             ← RTK mutates command; pi-dev-worktrees sees post-RTK command and applies routing
(tool executes)
tool_execution_update ← observation-only, streaming output
tool_execution_end    ← observation-only
tool_result           ← can return { content, details }
```

### Data flow: pi-dev-worktrees → dashboard client

1. pi-dev-worktrees emits `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` from `tool_call` handler
2. Bridge forwards automatically as `event_forward` message (existing mechanism, zero bridge changes)
3. Client event reducer catches `event_forward` with `eventType === "pi-dev-worktrees:bash-dispatch"`
4. Reducer patches the matching tool row's `args._dispatch` with the payload
5. `EnhancedBashToolRenderer` (registered via `registerToolRenderer("bash", ...)`) reads `args._dispatch` and renders chips

### What pi-dev-worktrees emits

```ts
pi.events.emit("pi-dev-worktrees:bash-dispatch", {
  toolCallId,
  llmCommand,
  routing,        // "host" | "container" | "error"
  rtkRewritten,
  rtkCommand,     // only when rtkRewritten
  hasDevcontainer,
});
```

### registerToolRenderer mechanism

`registerToolRenderer(toolName, Component)` replaces the built-in renderer for a tool. The plugin's `EnhancedBashToolRenderer` wraps the original `BashToolRenderer` — renders chips from `args._dispatch` when present, delegates to the original for standard rendering (output, streaming, etc.).

### Client reducer patch

When `event_forward` arrives with `eventType === "pi-dev-worktrees:bash-dispatch"`:
- Extract `toolCallId` from payload
- Find matching tool row in session events
- Patch `row.args._dispatch = { routing, rtkRewritten, rtkCommand, hasDevcontainer, llmCommand }`

This makes dispatch metadata available immediately (while tool is in-flight) without waiting for tool completion.

## Decisions

### D1: Tool-renderer replacement via `registerToolRenderer("bash", ...)`

Plugin replaces the built-in bash card entirely. `EnhancedBashToolRenderer` composes over the original `BashToolRenderer` — adds chip row when `args._dispatch` is present, delegates all other rendering. Clean separation: plugin owns the visual enrichment, core owns the base bash card.

### D2: Data flow via `event_forward` — zero bridge changes

`pi.events.emit` in extensions automatically forwards through the bridge as `event_forward` messages. No new bridge code, no `ctx.ui.notify` changes, no `prompt_request` mechanism. Simplest possible data path.

### D3: Client reducer patches tool row — `args._dispatch` carries routing metadata inline

Reducer intercepts `event_forward` with known `eventType`, patches the in-memory tool row. Data is co-located with the tool call args — no separate state, no suppression mechanism, no interactive-renderer lifecycle. The renderer reads `args._dispatch` synchronously.
