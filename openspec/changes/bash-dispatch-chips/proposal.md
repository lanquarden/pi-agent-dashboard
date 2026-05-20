## Why

When pi-dev-worktrees is active, every bash command is routed — either run on the host directly or wrapped in `devcontainer exec` and run inside a container. When pi-rtk-optimizer is active, commands may be rewritten (e.g. `grep` → `rtk grep`) before routing. The dashboard's bash tool card shows only the original LLM command with no indication of what actually ran or where.

This creates a grounding problem: the LLM sees `[host]` / `[container]` prefixes in the tool result text, but the developer looking at the dashboard card has no visual signal. They can't tell whether a command ran on the host or inside the container, or whether RTK rewrote it.

The fix uses the existing interactive-renderer suppression mechanism (the same one `ask_user` uses) to replace the standard bash card with a rich dispatch card showing chips for routing context and RTK rewrites — sourced from a structured event emitted by pi-dev-worktrees.

## What Changes

- **pi-dev-worktrees extension** (`pi-dev-worktrees` repo): emit a `bash-dispatch` prompt_request from the `tool_call` handler (immediately after routing, before execution), carrying original LLM command, RTK-rewritten command, final command, and routing decision. Uses `ctx.ui.notify` with `opts.toolCallId` so the prompt_request is paired with the bash tool card.
- **dashboard bridge** (`packages/extension/src/bridge.ts`): align `ctx.ui.notify` with the other patched methods — accept `opts?: { toolCallId?: string; level?: string }` and thread `toolCallId` through `buildMeta`. Backward-compatible: callers passing `(message, level)` continue to work.
- **dashboard-plugin-runtime** (`packages/dashboard-plugin-runtime`): re-export `registerInteractiveRenderer` from the client's interactive-renderer registry so plugins can register custom card renderers as a first-class supported pattern (not bash-specific).
- **pi-dev-worktrees-plugin** (`packages/pi-dev-worktrees-plugin`): register a `BashDispatchRenderer` for the `"bash-dispatch"` method type; renders chips for host/container routing and RTK rewrites while the command is in-flight; suppression mechanism auto-dismisses it when the tool completes.

## Capabilities

### New Capabilities

- `bash-dispatch-renderer`: Custom interactive renderer registered by pi-dev-worktrees-plugin for method `"bash-dispatch"`. Replaces the standard bash tool card **while the command is in-flight** — shows LLM command, RTK chip (when rewritten), and host/container routing chip. Auto-dismissed by the existing suppression mechanism when the tool result arrives.
- `plugin-card-replacement`: General capability — plugins can replace any built-in tool card for the duration of a tool call by emitting a `prompt_request` with `metadata.toolCallId` and registering a renderer via `registerInteractiveRenderer`. Documented as a supported plugin primitive.

### Modified Capabilities

- `notify-with-toolcallid`: Align `ctx.ui.notify` with other bridge-patched methods — accept `opts?: { toolCallId?: string; level?: string }` threaded through `buildMeta`. Backward-compatible signature change.
- `plugin-interactive-renderer-registration`: Re-export `registerInteractiveRenderer` from `@blackbelt-technology/dashboard-plugin-runtime` barrel (function already exists in `packages/client/src/components/interactive-renderers/registry.ts`; no implementation work needed, just export wiring).

## Impact

- **Files** (this repo):
  - `packages/extension/src/bridge.ts` — align notify patch signature with other methods: add `opts?: { toolCallId?: string; level?: string }`, thread through `buildMeta`
  - `packages/dashboard-plugin-runtime/src/index.ts` — re-export `registerInteractiveRenderer` from client registry
  - `packages/client/src/components/interactive-renderers/registry.ts` — no implementation change; already has `registerInteractiveRenderer`
  - `packages/pi-dev-worktrees-plugin/src/client/index.tsx` — call `registerInteractiveRenderer("bash-dispatch", BashDispatchRenderer)` on plugin load
  - `packages/pi-dev-worktrees-plugin/src/client/BashDispatchRenderer.tsx` — new component: in-flight chip card
- **Companion change**: `pi-dev-worktrees` repo — emit `bash-dispatch` prompt_request from `tool_call` handler with `toolCallId`
- **Tests**: bridge notify opts unit test, `registerInteractiveRenderer` export smoke test, `BashDispatchRenderer` render tests
- **Protocol**: no new WS message types; uses existing `prompt_request` with `metadata.toolCallId`
