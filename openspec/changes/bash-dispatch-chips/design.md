## Context

### How the suppression mechanism works

`findActiveInteractiveToolResultIds` (in `collapse-retried-errors.ts`) hides a `toolResult` row when it is immediately followed by a **pending** `interactiveUi` row with the same `toolCallId`. The `interactiveUi` renders alone via `getInteractiveRenderer(method)`. This is the same mechanism `ask_user` uses.

For this to work deliberately:
1. The `prompt_request` must carry `metadata.toolCallId` matching the bash tool call
2. It must arrive **after** `tool_execution_start` (so the `toolResult` row exists) — guaranteed because `tool_call` fires after `tool_execution_start`
3. The method type (`"bash-dispatch"`) must have a registered renderer

### Event ordering in pi (confirmed)

```
tool_execution_start  ← args = original LLM command → forwarded to dashboard
tool_call             ← RTK mutates command; pi-dev-worktrees sees post-RTK command and applies routing
(tool executes)
tool_execution_update ← observation-only, no return value, fires with streaming output
tool_execution_end    ← observation-only, no return value
tool_result           ← can return { content, details } → becomes toolDetails on the row
```

Both `tool_call` and `tool_result` handlers run in extension load order (same direction). Since `pi-rtk-optimizer` loads before `pi-dev-worktrees` in `settings.json`, pi-dev-worktrees sees the final state in both directions — post-RTK command in `tool_call`, post-RTK-compacted output in `tool_result`.

### What pi-dev-worktrees can observe

In its `tool_call` handler (before execution):
- `event.input.command` = post-RTK command (RTK already ran)
- Original LLM command = requires a `tool_execution_start` hook to capture `event.args.command`

In its `tool_result` handler (after execution):
- Full routing decision already made (`lastBashRouting`)
- RTK rewrite status (compare stored llmCommand vs what was in event.input at tool_call time)
- Can return `{ content: [...], details: { routing, rtkRewritten, llmCommand, rtkCommand } }`

### Extension return value capabilities (confirmed from types)

| Event | Can return result? | Dashboard effect |
|---|---|---|
| `tool_execution_start` | No | — |
| `tool_call` | Yes — mutates `event.input` | args forwarded in `tool_execution_start` (already fired, too late) |
| `tool_execution_update` | No | — |
| `tool_execution_end` | No | — |
| `tool_result` | Yes — `{ content?, details?, isError? }` | `details` → `toolDetails` on row via `tool_execution_end` |

`tool_execution_update` mutation of `event.partialResult` is observed by the bridge but only carries string output to the reducer — structured `details` can only come via `tool_result`.

### Two candidate approaches

#### Path A: `tool_result` returning `details` → `toolDetails`

Pi-dev-worktrees returns `{ content: [...], details: { routing, rtkRewritten, llmCommand, rtkCommand } }` from its `tool_result` handler. The bridge forwards this as `tool_execution_end` data. The reducer sets `toolDetails` on the tool row at completion. `BashToolRenderer` reads `toolDetails` and renders chips.

**Pros:**
- No bridge changes needed
- No new prompt_request mechanism
- Clean extension API usage
- Chips are permanent in history

**Cons:**
- Chips only appear *after* the tool completes — nothing while running
- Requires modifying `BashToolRenderer.tsx` in the core client to read `toolDetails`
- No card replacement — chips sit inside the existing bash card layout
- `BashToolRenderer` currently doesn't receive `toolDetails` (it's passed to `ToolCallStep` but not threaded into the renderer props... actually `ToolRendererProps` does have `toolDetails?: Record<string, unknown>` — needs verification that `ToolCallStep` passes it through)

#### Path B: `prompt_request` with `toolCallId` (bash-dispatch)

Pi-dev-worktrees emits a structured `prompt_request` from its `tool_call` handler with `toolCallId` in metadata. This creates a paired `interactiveUi` row that suppresses the standard bash card while `pending`. A custom `BashDispatchRenderer` registered by pi-dev-worktrees-plugin renders the full replacement card with chips.

**Pros:**
- Chips visible immediately while command is running
- Full card replacement — complete visual control
- No `BashToolRenderer` core changes needed
- Clean "in-flight context" vs "history" separation (pending → resolved)

**Cons:**
- Requires two bridge gaps to be filled:
  1. `ctx.ui.notify` needs `opts.toolCallId` support (currently hardcoded `(message, level)`)
  2. `registerInteractiveRenderer` not exported from `dashboard-plugin-runtime` — needs side-channel registry
- More moving parts (two repos: extension + dashboard)
- Dismiss/resolve lifecycle needs careful handling

### Current gaps for Path B (confirmed)

**Gap 1: `ctx.ui.notify` has no `opts`/`toolCallId` support**
The bridge patches notify as `(message: string, level?: string) => { ... }` — no third parameter. All other patched methods (`select`, `input`, `confirm`, `editor`) already use `buildMeta(opts)` with `toolCallId`. Notify needs the same treatment.

**Gap 2: `registerInteractiveRenderer` unreachable from plugins**
Lives only in `packages/client/src/components/interactive-renderers/registry.ts`, not exported from `@blackbelt-technology/dashboard-plugin-runtime`. Plugins can't call it without breaking the client/plugin boundary.

### Does `BashToolRenderer` actually receive `toolDetails`?

`ToolRendererProps` has `toolDetails?: Record<string, unknown>` and `ToolCallStep` receives it, but `BashToolRenderer` currently ignores it entirely. For Path A, `BashToolRenderer` needs to be updated to read `toolDetails?.routing` and `toolDetails?.rtkRewritten`. This is a small targeted change but it does touch the core client.

## Decisions

### D1: Path B — immediate in-flight feedback

Chips must be visible while the command is running, not only after completion. Path A (chips via `tool_result` → `toolDetails`) only shows feedback after the tool finishes. **Path B is chosen**: emit a `prompt_request` with `toolCallId` from the `tool_call` handler in pi-dev-worktrees so the suppression mechanism hides the bare bash card immediately and the `BashDispatchRenderer` renders in its place.

### D2: General plugin card replacement capability

The ability to register a custom interactive renderer that suppresses a built-in tool card is broadly useful (e.g. future flow cards, custom tool visualizers). This is not modelled as bash-specific. The capability is:
- `registerInteractiveRenderer` exported from `@blackbelt-technology/dashboard-plugin-runtime` (the function already exists in `packages/client/src/components/interactive-renderers/registry.ts`; it just needs re-exporting through the plugin runtime barrel)
- Plugins register renderers keyed by `method` string; the suppression mechanism (existing `findActiveInteractiveToolResultIds`) already handles dismiss when the tool completes — no special lifecycle code needed
- This makes the card-replacement pattern a documented, supported plugin primitive

### D3: Bridge notify aligned with existing messages

`ctx.ui.notify` is the only patched method that does not accept `opts`/`toolCallId`. All other patched methods (`select`, `input`, `confirm`, `editor`, `multiselect`) already thread `opts` through `buildMeta`. The fix:
- Change notify signature to `(message: string, levelOrOpts?: string | { toolCallId?: string; level?: string }, opts?: { toolCallId?: string })`
- Thread `toolCallId` through `buildMeta` so the forwarded `prompt_request` carries `metadata.toolCallId`
- The `toolCallId` parameter is optional — existing callers that pass only `(message, level)` continue to work unchanged
- No new WS message type needed; uses existing `prompt_request` with `component.type` set to the custom method (e.g. `"bash-dispatch"`)
