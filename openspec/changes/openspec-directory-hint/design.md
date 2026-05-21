## Context

The bridge auto-forwards all `pi.events.emit(...)` calls as `event_forward` messages to the server. The `event-wiring.ts` handler dispatches on `eventType`. Adding plugin-specific names would couple the core server to a specific extension — wrong layer. The `openspec:` prefix scopes the contract to the OpenSpec feature without naming the caller.

Investigation revealed four bugs that each needed fixing independently:

1. `refreshOpenSpec` was fire-and-forget — polled and cached but never called `broadcastToAll` so `openspecMap` on the client never received the worktree entry.
2. All client OpenSpec map lookups used `session.cwd`, which never matches the worktree path stored in `openspecMap`.
3. `computeKnownDirectories()` only iterated `session.cwd` — the worktree path was polled once then dropped from subsequent 30s ticks.
4. `/api/file` validated `cwd` against `session.cwd` only — artifact file reads with the worktree cwd were rejected 403 ("unknown session path").

The actual attach dialog source is `SessionList.tsx` (sidebar cards), not `App.tsx` content pane — both needed fixing but `SessionList.tsx` was the critical path.

## Goals / Non-Goals

**Goals:**
- Handle `openspec:directory_hint` in `event-wiring.ts` generically
- `refreshOpenSpec` result broadcast via `broadcastToAll({ openspec_update })`
- Store `openspecCwd` on session and broadcast `session_updated`
- `computeKnownDirectories()` includes `session.openspecCwd` for periodic polling
- All client openspecMap lookups, `onReadArtifact`, and `onBulkArchive` use `session.openspecCwd ?? session.cwd`
- `/api/file` cwd guard allows `session.openspecCwd` paths

**Non-Goals:**
- Persisting `openspecCwd` to `.meta.json` — transient, re-established on next hint
- Clearing `openspecCwd` on worktree-off — field persists; directory returns empty data once removed; subcard collapses naturally

## Decisions

### 1. Event type name: `openspec:directory_hint`
**Decision**: Use `openspec:directory_hint` as the `eventType`. Colon-namespaced per existing convention. `openspec:` prefix scopes it to the OpenSpec feature; `directory_hint` signals it is advisory.

### 2. Early-return, not stored
**Decision**: Return early from the `event_forward` handler — event NOT inserted into session event store, NOT broadcast as a raw event. Only the derived `session_updated { openspecCwd }` and `openspec_update` are sent.

### 3. Broadcast poll result immediately
**Decision**: Chain `.then((data) => browserGateway.broadcastToAll({ type: "openspec_update", cwd: path, data }))` on `refreshOpenSpec`. Without this the client's `openspecMap` never receives the worktree entry regardless of the session field fix.

### 4. `openspecCwd` field on `DashboardSession`
**Decision**: Add `openspecCwd?: string` to `DashboardSession`. Absent → use `session.cwd` (backward-compatible). Set by server on hint receipt; broadcast via `session_updated`.

### 5. `computeKnownDirectories` includes `openspecCwd`
**Decision**: Also add `session.openspecCwd` when iterating sessions. Without this the worktree path is polled once then silently dropped from the 30s tick.

### 6. `SessionList.tsx` is the critical client fix
**Decision**: All six openspec props on the sidebar `SessionCard` plus `onReadArtifact` and `onBulkArchive` must use `session.openspecCwd ?? session.cwd`. `App.tsx` desktop and mobile paths fixed for completeness.

### 7. `/api/file` cwd guard extended
**Decision**: Allow `cwd` matching `session.openspecCwd` (any session) or any pinned directory, in addition to `session.cwd`. Without this, clicking artifact letters to view proposal/design content returns 403 because the guard rejected the worktree path.

### 8. Clearing `openspecCwd`
**Decision**: Not implemented. Field persists for session lifetime. Deactivated worktree → directory returns empty data → subcard collapses naturally. No UI breakage.

## Risks / Trade-offs

- **[Stale openspecCwd after server restart]** Not persisted — lost on restart. Session falls back to `cwd` until next `/worktree` command re-emits the hint. Acceptable transient gap.
- **[Multiple sessions, same cwd, different worktrees]** Each session gets its own `openspecCwd` — correct, `sessionManager.update` is per session-id.
- **[File API guard widening]** Allowing `openspecCwd` paths in `/api/file` is safe — the path still must be a resolved child of `cwd` (the path traversal guard below the cwd check remains).
