## Context

Dashboard renders `Agent` tool calls (`@tintinweb/pi-subagents` or `pi-dashboard-agent`) as cards via `AgentToolRenderer`. Today the card is static — no way to see the subagent's actual reasoning, tool calls, or assistant text. This change adds inline expansion + a dedicated popout route so users can inspect a subagent's run in detail.

The producer of the rich timeline is the new `pi-dashboard-agent` extension (separate repo, foreground-only, in-memory spawn). Its wire contract is locked in `scaffold-foreground-subagent-extension` at `/home/skrot1/BB/pi-packages/pi-dashboard-agents/openspec/changes/`. This change consumes that contract.

## Goals / Non-Goals

**Goals:**

- Inline-expandable agent card with full timeline (tool / text / thinking / error).
- Popout route `/session/:sid/subagent/:aid` so users can open the inspector in a new tab.
- Graceful fallback when the timeline producer (`pi-dashboard-agent`) isn't installed — show summary + counters + upgrade footnote.
- `GetSubagentResultRenderer` gains a "Show details" affordance that opens the popout (relevant only for `@tintinweb/pi-subagents` coexistence).

**Non-Goals:**

- Background subagents. The producer extension is foreground-only by design; the dashboard's status-bar pill / panel that was originally planned has been dropped.
- New event protocol or bridge changes. The bridge already forwards `subagents:*` events from any extension that emits them via its emit-intercept.
- LLM-driven timeline summarization. Verbatim entries from the producer.

## Decisions

### Decision 1: One component, three modes

`SubagentDetailView` is the single renderer. Three modes:

- `inline` — `max-h-[60vh]` with internal scroll, used inside the expanded `AgentToolRenderer` card.
- `popout` — full viewport, used by `SubagentPopoutPage`.
- `row` — single-line summary, available for any future consumer.

This keeps the rendering logic in one place and lets future producers (or the same producer at a later version) light up the same UI.

### Decision 2: Popout is a browser tab at a stable URL

`/session/<sid>/subagent/<aid>` opens via `window.open(url, "_blank")`. Reasons:

- Multi-monitor friendly.
- Same routing mechanism as existing session URLs.
- Survives reloads (state re-derived from streamed events when the parent session is subscribed).
- Trivially shareable.

Rejected alternatives: floating draggable pane (worse multi-monitor, more React surface); native OS-level window (Electron-only).

### Decision 3: Graceful four-tier degradation in `SubagentDetailView`

- Tier 1 (entries present): full timeline.
- Tier 2 (running, no entries): activity + counters + upgrade footnote.
- Tier 3 (completed/failed, no entries): result/error block.
- Tier 4 (no useful data): "No detail available yet."

Lets the dashboard work both with `pi-dashboard-agent` (Tier 1) and `@tintinweb/pi-subagents` (Tier 2/3) without code branching at the renderer level.

### Decision 4: Background-subagents UI dropped

Originally this change included a `BackgroundSubagentsPill` in the status bar listing in-flight background subagents. That has been **removed entirely** because the new producer (`pi-dashboard-agent`) is foreground-only. The pill had no data source under the new architecture. If a future producer needs background visibility, it can be added back as a separate change.

### Decision 5: `ToolContext` carries `sessionId` + `session`

Renderers that need session-scoped URLs (popout) or per-session state (timeline) read these from context. The alternative (React context provider) was rejected as overkill — `ToolContext` already flows through the renderer interface.

### Decision 6: Popout subscribes to parent session in fresh tabs

When the popout URL opens in a brand-new tab, the parent session has not been subscribed. The page must trigger subscription itself. We add a `useEffect` in `App.tsx` that calls `send({ type: "subscribe", sessionId })` when a popout route is matched and the session isn't already subscribed. Without this, fresh-tab popouts forever show "Loading…".

### Decision 7: Reducer backfills `subagents` map from `tool_execution_end`

The `subagents: Map<string, SubagentState>` slot is canonical for the inspector — `SubagentDetailView` and `SubagentPopoutPage` both read `session.subagents.get(agentId)` exclusively. Today the only writers are the four live `subagent_*` event handlers (`event-reducer.ts:1287/1301/1316`). Replay (`state-replay.ts`) does NOT synthesize `subagent_*` events; it only synthesizes `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `stats_update`, and `model_select`.

Result: completed subagents survive in the parent's JSONL (their full `AgentDetails` rides inside `ToolResultMessage.details` per pi-coding-agent's session format), but after a `/resume` or page refresh the map is empty — the collapsed card reads `messages[i].toolDetails` directly and works, but expand+popout call into `SubagentDetailView`, see an empty `subagents.get(agentId)`, and render "Subagent not found."

The `state-replay.ts:128` code path already threads `msg.details` into the synthesized `tool_execution_end.data.details`. Adding a write to `next.subagents` inside the existing `tool_execution_end` handler (gated on `toolName === "Agent"` and `data.details?.agentId`) closes the loop without touching replay, the bridge, the producer, or any new event channel.

Alternatives considered:

- **Synthesize `subagent_completed` inside `state-replay.ts`** when walking JSONL. Rejected because replay's job is to derive minimum events to rebuild the chat view; subagent state is a derived view of tool-result data and belongs in the reducer, not in replay. Also forces replay to grow producer-specific knowledge of the `Agent` tool name in a layer that is otherwise tool-agnostic.
- **Make `SubagentDetailView` accept entries via prop and fall back to `messages[i].toolDetails`** when the map is empty. Rejected because it fixes the inline-expand case but not the popout (the popout route has no message context to read; it only has `sessionId` + `agentId`).
- **Server-side ring buffer of `subagent_*` events** so reconnects can replay them. Rejected for this change — it adds infrastructure (a per-session bounded queue keyed by `agentId`) and only helps the live-mid-flight case (refresh while a subagent is still running). The vast majority of inspector traffic is post-hoc and is fully covered by backfill. Mid-flight survival can be added later if it proves needed; tracked under "Open Questions" below.

Merge semantics: when both a live `subagent_completed` and a backfill from `tool_execution_end` arrive for the same `agentId` (the order is not guaranteed, especially across replay+live transitions), the handler preserves prior non-undefined fields rather than blindly overwriting. This makes the two paths commutative and prevents either source from clobbering richer information from the other.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| User opens popout but doesn't have `pi-dashboard-agent` installed → empty timeline | Tier-2 footnote tells them what to install. |
| Parent session deleted/archived while popout is open | "Parent session not found" empty state with explicit "close this tab" CTA. |
| Popout URL gets stale when sessionId is reassigned | Acceptable — same behavior as any session URL today. |
| App.tsx wiring is not yet shipped (see proposal.md "Status") | Commit is flagged WIP. Components are inert without wiring; no regression vs. before this change. |
| Producer wire-format changes break this consumer | The contract is locked in `pi-dashboard-agent`'s openspec; both repos must move together for breaking changes. |
| Backfill writes to subagents map could race with live `subagent_*` events for the same id | Merge semantics in Decision 7 preserve non-undefined prior fields, making live + replay paths commutative. |
| Mid-flight subagent state is still lost on refresh (only completed runs survive via backfill) | Acceptable for v0.1.x — producer is foreground-only and runs are short. Tracked as Open Question; future change can add a server-side replay buffer if needed. |

## Migration Plan

None. Pure additive change. No state migration. No protocol breakage. Users with only `@tintinweb/pi-subagents` installed see Tier-2 fallback; users who add `pi-dashboard-agent` see Tier-1 automatically.

## Open Questions (resolved)

- ~~Should the pill show completed background subagents?~~ — N/A, pill dropped.
- ~~Should the popout show on session end?~~ — Yes, the popout subscribes independently; the dashboard's session-ended status doesn't unmount it.
- Should the Tier-2 upgrade footnote eventually be removed? — Yes, in a follow-up once `pi-dashboard-agent` is the de-facto producer (tasks.md §10.3).
- Should mid-flight subagents survive a dashboard refresh (i.e. a refresh while the subagent is still running, before the parent has written the tool result to JSONL)? — Out of scope here; would require a server-side per-session ring buffer of recent `subagent_*` events keyed by `agentId`, drained on `subagent_completed/failed`. Tracked as a candidate follow-up change.
