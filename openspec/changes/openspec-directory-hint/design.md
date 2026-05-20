## Context

The bridge auto-forwards all `pi.events.emit(...)` calls as `event_forward` messages to the server. The `event-wiring.ts` `event_forward` handler dispatches on `eventType`. Phase 1 (already implemented) added the `openspec:directory_hint` handler that calls `directoryService.refreshOpenSpec(path)` and returns early without storing the event.

Phase 1 was necessary but not sufficient. The client populates the OpenSpec attach dialog and session card by calling `openspecMap.get(session.cwd)`. `openspecMap` is keyed by the directory the server polled. After a hint, the server polls and stores data under the **worktree path** — but `session.cwd` is the main repo root. The keys never match so the attach dialog shows no changes.

The fix is to record the hinted path as `session.openspecCwd` so the client can resolve `openspecMap.get(session.openspecCwd ?? session.cwd)` instead.

## Goals / Non-Goals

**Goals:**
- Store `openspecCwd` on `DashboardSession` when a hint is received, broadcast to browsers
- Client uses `openspecCwd ?? cwd` as the openspecMap key in all relevant lookups
- When worktree is deactivated (hint with the original cwd, or extension off event) clear `openspecCwd` so fallback to `session.cwd` resumes

**Non-Goals:**
- Persisting `openspecCwd` to `.meta.json` — it is transient, re-established on next hint
- Changing how `openspec_update` is broadcast (still keyed by polled directory — correct)
- Any UI changes beyond using the right map key

## Decisions

### 1. `openspecCwd` field on `DashboardSession`
**Decision**: Add `openspecCwd?: string` to `DashboardSession` in `types.ts`. Absent means use `session.cwd` (backward-compatible fallback for all existing sessions and for sessions where no hint has been received).

**Rationale**: Minimal protocol change. One optional string field. The client only needs to know one thing: "which key should I use for the openspecMap lookup for this session?" The field answers that directly.

### 2. Server sets `openspecCwd` on hint receipt
**Decision**: In `event-wiring.ts`, after `directoryService.refreshOpenSpec(path)`, call `sessionManager.update(sessionId, { openspecCwd: path })` and `browserGateway.broadcastSessionUpdated(sessionId, { openspecCwd: path })`.

**Rationale**: The server already has `sessionId` (from the `event_forward` envelope) and `path` (from the payload). Storing it on the session is the natural place — it follows the same pattern as `openspecPhase`, `openspecChange`, etc.

### 3. Client lookup: `session.openspecCwd ?? session.cwd`
**Decision**: Every place in the client that calls `openspecMap.get(session.cwd)` or `openspecMap.get(selectedCwd)` should instead use `session.openspecCwd ?? session.cwd`. Affected sites: `App.tsx` (two `openspecChanges` props, mobile actions), `SessionCard.tsx` if it reads cwd directly.

**Rationale**: The fallback `?? session.cwd` preserves all existing behaviour for sessions that never receive a hint.

### 4. Clearing `openspecCwd`
**Decision**: Not implemented in this change. The field persists for the session lifetime. If the worktree is deactivated, the field stays set but points to a directory that returns `{ initialized: false, changes: [] }` once the worktree is removed. The OpenSpec subcard collapses naturally. A future change can emit a hint back to the original cwd on worktree-off if needed.

**Rationale**: YAGNI. The deactivation case does not cause UI breakage — it just shows no changes, which is correct. Adding a clear mechanism now adds complexity for no observable benefit in the common workflow.

## Risks / Trade-offs

- **[Stale openspecCwd after server restart]** `openspecCwd` is not persisted, so after a server restart the field is gone. The session will fall back to `session.cwd`. The worktree extension re-emits the hint on the next `before_agent_start` or similar. Mitigation: acceptable transient gap; the session card just shows no changes until next hint.
- **[Multiple sessions same cwd, different worktrees]** Two sessions both in the same main repo cwd but with different active worktrees each get their own `openspecCwd` — correct, since `sessionManager.update` is per-session-id.
