## Context

The bridge auto-forwards all `pi.events.emit(...)` calls as `event_forward` messages to the server. The `event-wiring.ts` handler dispatches on `eventType`. Adding plugin-specific names (e.g. `pi-dev-worktrees:workspace-switched`) would couple the core server to a specific extension — wrong layer. The `openspec:` prefix scopes the contract to the OpenSpec feature without naming the caller.

Investigation revealed three bugs that each needed fixing independently:

1. `refreshOpenSpec` was fire-and-forget — polled and cached but never called `broadcastToAll` so `openspecMap` on the client never received the worktree entry.
2. All client OpenSpec map lookups used `session.cwd`, which never matches the worktree path stored in `openspecMap`.
3. `computeKnownDirectories()` only iterated `session.cwd` — the worktree path was polled once then dropped from subsequent 30s ticks.

The actual attach dialog source is `SessionList.tsx` (sidebar cards), not `App.tsx` content pane — both needed fixing but `SessionList.tsx` was the critical path.

## Goals / Non-Goals

**Goals:**
- Handle `openspec:directory_hint` in `event-wiring.ts` generically — no knowledge of which plugin emitted it
- `refreshOpenSpec` result broadcast to all browsers via `broadcastToAll({ openspec_update })`
- Store `openspecCwd` on session and broadcast `session_updated` so client has the key
- `computeKnownDirectories()` includes `session.openspecCwd` for ongoing periodic polling
- All client openspecMap lookups use `session.openspecCwd ?? session.cwd`

**Non-Goals:**
- Persisting `openspecCwd` to `.meta.json` — transient, re-established on next hint
- Clearing `openspecCwd` on worktree-off — field persists; points to directory that returns empty data once removed; subcard collapses naturally
- Any UI changes beyond using the right map key

## Decisions

### 1. Event type name: `openspec:directory_hint`
**Decision**: Use `openspec:directory_hint` as the `eventType`. Colon-namespaced per existing convention. `openspec:` prefix scopes it to the OpenSpec feature; `directory_hint` signals it is advisory.

### 2. Early-return, not stored
**Decision**: Return early from the `event_forward` handler after processing — event NOT inserted into session event store, NOT broadcast as a raw event. Only the derived `session_updated { openspecCwd }` and `openspec_update` are sent.

### 3. Broadcast poll result immediately
**Decision**: `refreshOpenSpec(path)` returns `Promise<OpenSpecData>`. Chain `.then((data) => browserGateway.broadcastToAll({ type: "openspec_update", cwd: path, data }))`. Without this the client's `openspecMap` never receives the worktree entry regardless of the session field fix.

### 4. `openspecCwd` field on `DashboardSession`
**Decision**: Add `openspecCwd?: string` to `DashboardSession`. Absent → use `session.cwd` (backward-compatible). Set by server on hint receipt; broadcast via `session_updated`.

### 5. `computeKnownDirectories` includes `openspecCwd`
**Decision**: In `directory-service.ts`, when iterating sessions to build the known directories set, also add `session.openspecCwd` when present. Without this the worktree path is polled once then silently dropped from the 30s periodic tick.

### 6. `SessionList.tsx` is the critical client fix
**Decision**: All four openspec props on the sidebar `SessionCard` (`openspecChanges`, `openspecInitialized`, `openspecPending`, `openspecHasDir`) plus both group map props must use `session.openspecCwd ?? session.cwd`. `App.tsx` desktop and mobile paths also fixed for completeness but `SessionList.tsx` is the attach dialog source.

### 7. Clearing `openspecCwd`
**Decision**: Not implemented. Field persists for session lifetime. Deactivated worktree → directory returns empty data → subcard collapses naturally. No UI breakage.

## Risks / Trade-offs

- **[Stale openspecCwd after server restart]** Not persisted — lost on restart. Session falls back to `cwd` until next `/worktree` command re-emits the hint. Acceptable transient gap.
- **[Multiple sessions, same cwd, different worktrees]** Each session gets its own `openspecCwd` — correct, `sessionManager.update` is per session-id.
- **[Spam]** Rapid hint emission bounded by `maxConcurrentSpawns` semaphore inside `pollOne`. No additional rate-limiting needed.
