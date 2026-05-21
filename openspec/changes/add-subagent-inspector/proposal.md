## Why

The dashboard renders subagent (Agent tool) results via `AgentToolRenderer.tsx`. Today it shows:

- Summary fields (displayName, status, activity, toolUses, tokens) inline on a static card.
- No way to drill into the subagent's reasoning, tool calls, or assistant text.
- No popout / dedicated view for inspecting a subagent's full run.

We need a subagent inspector that lets users:

- **Expand** the agent card inline to see the full timeline (tool calls, reasoning, assistant text, errors).
- **Pop out** the inspector to a dedicated route (`/session/<sid>/subagent/<aid>`) for full-window viewing in a new tab.
- See the agent's source `.md` file path so they can open the definition (e.g. `~/.pi/agent/agents/Explore.md`).

This change establishes the dashboard-side consumer contract. The producer is the new `pi-dashboard-subagents` extension (separate repo at `/home/skrot1/BB/pi-packages/pi-dashboard-agents/`), which spawns subagents in-memory via `createAgentSession` and emits `subagents:*` events on pi's event bus carrying the full timeline.

The inspector code lives in its **own workspace plugin package** `packages/subagents-plugin/` — analogous to `packages/flows-plugin/` — so:

- Shell remains free of subagent-specific rendering code.
- Inspector ships as a discrete unit (versionable independently in principle).
- Future `extract-subagents-as-plugin` can move the renderer + reducer slice into the same plugin without disturbing the inspector.

## Status: WIP / unfinished

This change is **committed but unfinished**. Specifically:

- ✅ `packages/subagents-plugin/` workspace package with manifest, exports, types — DONE
- ✅ `SubagentDetailView` component (3 modes: inline, popout, row) — DONE, in plugin
- ✅ `SubagentPopoutPage` route content — DONE, in plugin
- ✅ `SubagentTimelineEntry` + `SubagentState` types — DONE, in plugin; re-exported from shell's `event-reducer.ts` for legacy consumers
- ✅ `AgentToolRenderer` extended with expand toggle + popout button (imports `SubagentDetailView` from plugin) — DONE
- ✅ `GetSubagentResultRenderer` extended with "Show details" link — DONE
- ✅ Shell reducer extended with `readSubagentDetails` helper + new fields on `SubagentState` — DONE
- ✅ `ToolContext` extended with `sessionId` + `session` — DONE
- ⚠️ **`App.tsx` route registration + `toolContext.sessionId` wiring — NOT YET DONE**
  - The `/session/:sid/subagent/:aid` route is not registered. Popout buttons will fail to open.
  - The `toolContext` passed to ChatView does not include `sessionId`, so the popout URL cannot be built. Buttons render as disabled.
  - This wiring was done in an earlier draft but was lost in a working-copy reset. Needs to be re-added before this change can ship.
- ⚠️ **Reducer backfill from `tool_execution_end` — NOT YET DONE.**
  - `state.subagents.get(agentId)` is the canonical source for both inline-expand and popout. The only writers today are the live `subagent_*` event handlers. `state-replay.ts` does NOT synthesize those events, so after `/resume` or a page refresh, every completed subagent’s map entry is missing — the popout renders "Subagent not found" even though the full `AgentDetails` is sitting in the parent’s JSONL inside `ToolResultMessage.details`.
  - Fix: the reducer’s `tool_execution_end` handler also writes to `next.subagents` when `toolName === "Agent"` and `data.details?.agentId` is present. See `tasks.md` §12 for tasks and `design.md` Decision 7 for rationale + considered alternatives.
  - Mid-flight survival (refresh while a subagent is still running, before the parent has persisted the tool result) is explicitly OUT OF SCOPE here — see Open Questions in `design.md`.
- ❌ Background-subagents pill & panel — DROPPED (was originally in scope, now removed; producer extension is foreground-only).

## What Changes (compared to before this change)

**NEW workspace package**

- **NEW** `packages/subagents-plugin/` — workspace plugin package with `pi-dashboard-plugin` manifest (id: `subagents`, claims currently empty; future `extract-subagents-as-plugin` adds `tool-renderer` claims).
- **NEW** `packages/subagents-plugin/src/client/SubagentDetailView.tsx` — one component, three modes (inline, popout, row). Reads `SessionStateLike.subagents`. Four-tier graceful degradation. Uses `useUiPrimitive` for markdown rendering (no hard dep on shell components).
- **NEW** `packages/subagents-plugin/src/client/SubagentPopoutPage.tsx` — fullscreen route content for `/session/:sid/subagent/:aid`. Shows loading / parent-not-found / subagent-not-found / detail states.
- **NEW** `packages/subagents-plugin/src/client/types.ts` — `SubagentTimelineEntry` discriminated union + `SubagentState` interface (the canonical wire-contract types).
- **NEW** `packages/subagents-plugin/src/client/index.tsx` — barrel re-exporting the above.
- **NEW** tests under `packages/subagents-plugin/src/client/__tests__/`.

**Modified shell-side files**

- **MODIFY** `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` — expand toggle + popout button; imports `SubagentDetailView` from the plugin.
- **MODIFY** `packages/client/src/components/tool-renderers/GetSubagentResultRenderer.tsx` — adds "Show details" affordance opening the popout route.
- **MODIFY** `packages/client/src/components/tool-renderers/types.ts` — `ToolContext` gains optional `sessionId?: string` and `session?: SessionState`.
- **MODIFY** `packages/client/src/lib/event-reducer.ts` — `SubagentState` / `SubagentTimelineEntry` types now re-exported from the plugin (single canonical location); `readSubagentDetails(details)` helper kept in shell for now; reducer handlers for `subagent_*` events read `data.details` via the helper. **PENDING:** the existing `tool_execution_end` handler also writes to `next.subagents` when the event refers to a completed Agent run (`toolName === "Agent"` AND `data.details?.agentId` present), using `readSubagentDetails` plus merge-on-prior-non-undefined semantics. This is what makes `/resume` and page refresh correctly re-hydrate the inspector for completed subagents — the producer already persists the full `AgentDetails` inside the parent’s `ToolResultMessage.details`, and `state-replay.ts` already threads `msg.details` through synthesized `tool_execution_end` events; this requirement closes the loop on the consumer side.
- **MODIFY** `packages/client/package.json` — adds workspace dep on `@blackbelt-technology/pi-dashboard-subagents-plugin`.
- **MODIFY** `packages/client/src/components/__tests__/AgentToolRenderer.test.tsx` — wraps in `withUiPrimitiveProvider` because the imported `SubagentDetailView` uses the primitives registry.
- **PENDING** `packages/client/src/App.tsx` — register route, mount `<SubagentPopoutPage>`, pass `sessionId` + `session` through `toolContext`. Subscribe to parent session when popout loaded in a fresh tab.

## Capabilities

### Modified Capabilities

- `agent-tool-rendering` — extends with inline-expand, popout button, popout route, and the data-shape contract for `SubagentTimelineEntry`. The renderer/route code now lives in the `subagents-plugin` workspace package; the shell imports from it. Producer of the entries is `pi-dashboard-subagents` v0.1.x. `@tintinweb/pi-subagents` only streams summary data, so the inspector falls back to a "Showing summary; install pi-dashboard-subagents for full timeline" footnote when entries[] is absent.

## Impact

- 5 new plugin files (~700 LOC including tests + package.json + tsconfig).
- 5 modified shell files (~50 LOC churn since most logic moved to plugin).
- App.tsx wiring pending (~100 LOC, NOT in this commit).
- No server-side changes.
- No bridge / extension package changes.

## Out of scope

- **Background subagents**: the producer (`pi-dashboard-subagents`) is foreground-only by design. The original v1 of this change included a status-bar pill listing background subagents — that's been dropped.
- **`get_subagent_result` / `steer_subagent` tools**: these are `@tintinweb/pi-subagents`-specific and not produced by `pi-dashboard-subagents`. The renderer for `get_subagent_result` is retained to keep `@tintinweb/pi-subagents` coexistence working.
- **Upstream prompt-cache fork**: orthogonal concern owned by `pi-dashboard-subagents`. Not visible at the dashboard layer.
- **Moving the AgentToolRenderer + GetSubagentResultRenderer + SteerSubagentRenderer + reducer slice into the plugin**: covered by the separate `extract-subagents-as-plugin` change. That change supplements (not supersedes) this one — they compose.

## Dependencies

- `pi-dashboard-subagents` v0.1.x — the producer of `entries[]`. Until users install this extension, the dashboard shows Tier-2 fallback (activity + counts + footnote). The contract is documented in `/home/skrot1/BB/pi-packages/pi-dashboard-agents/openspec/changes/scaffold-foreground-subagent-extension/`.
- `extract-subagents-as-plugin` — separate change that completes the plugin extraction (moves renderers + reducer slice). After both changes land, the shell has no subagent-specific code at all.
