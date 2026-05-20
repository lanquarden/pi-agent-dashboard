## Why

When pi-dev-worktrees is active, every bash command is routed — either run on the host directly or wrapped in `devcontainer exec`. When pi-rtk-optimizer is active, commands may be rewritten before routing. The dashboard's bash tool card shows only the original LLM command with no indication of what actually ran or where.

The fix uses a tool-renderer replacement pattern: pi-dev-worktrees emits a structured event, the client reducer patches the tool row, and the plugin's `EnhancedBashToolRenderer` renders chips showing routing context and RTK rewrites.

## What Changes

- **pi-dev-worktrees extension** (`pi-dev-worktrees` repo): emit `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` from `tool_call` handler after routing. Payload carries `toolCallId`, `llmCommand`, `routing`, `rtkRewritten`, `rtkCommand`, `hasDevcontainer`.
- **Client event reducer** (`src/client/`): handle `event_forward` with `eventType === "pi-dev-worktrees:bash-dispatch"` — patch matching tool row's `args._pluginData[eventType]` with dispatch metadata.
- **dashboard-plugin-runtime** (`packages/dashboard-plugin-runtime`): export `registerToolRenderer` so plugins can replace built-in tool renderers.
- **pi-dev-worktrees-plugin** (`packages/pi-dev-worktrees-plugin`): register `EnhancedBashToolRenderer` via `registerToolRenderer("bash", ...)` — renders chips from `args._pluginData[eventType]`, delegates to original `BashToolRenderer` for standard rendering.

No bridge changes needed. No `prompt_request`, no suppression mechanism, no interactive renderer.

## Capabilities

### New Capabilities

- `tool-renderer-replacement`: Plugins replace built-in tool renderers via `registerToolRenderer(toolName, Component)`. Plugin renderer wraps or replaces the original.
- `bash-dispatch-chips`: `EnhancedBashToolRenderer` renders routing/RTK chips on bash tool cards when `args._pluginData[eventType]` is present.

### Modified Capabilities

- `event-forward-reducer`: Client event reducer extended to handle plugin-specific `event_forward` types and patch tool row state.

## Impact

- **Files** (this repo):
  - `packages/dashboard-plugin-runtime/src/index.ts` — export `registerToolRenderer`
  - Client event reducer — handle `pi-dev-worktrees:bash-dispatch` event_forward
  - `packages/pi-dev-worktrees-plugin/src/client/EnhancedBashToolRenderer.tsx` — new component
  - `packages/pi-dev-worktrees-plugin/src/client/index.tsx` — register tool renderer
- **Companion change**: `pi-dev-worktrees` repo — emit pi event from `tool_call` handler
- **Tests**: reducer patch test, `EnhancedBashToolRenderer` render tests
- **Protocol**: no new WS message types; uses existing `event_forward`
