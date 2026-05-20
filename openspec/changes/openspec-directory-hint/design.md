## Context

The dashboard server builds its OpenSpec poll set (`computeKnownDirectories`) from two sources: pinned directories (user-configured) and `session.cwd` values (registered when a bridge connects). This is sufficient when the session's working directory matches where `openspec/` lives.

When a bridge extension like `pi-dev-worktrees` activates a git worktree mid-session, the session `cwd` stays at the main repo root but all file activity moves to the worktree path. The server never learns about the worktree, so no OpenSpec subcard appears for it.

The bridge auto-forwards all `pi.events.emit(...)` calls as `event_forward` messages to the server. The `event-wiring.ts` `event_forward` handler already dispatches on `eventType` for a handful of pi-internal events (`queue_state`, `tool_execution_start`, `agent_end`, `turn_end`). These are all pi core events. Adding plugin-specific event names (e.g. `pi-dev-worktrees:workspace-switched`) there would couple the core server to a specific plugin — wrong layer.

The right contract is a generic, openspec-scoped event type: `openspec:directory_hint`. Any extension can emit it. The server reacts by polling that path. The naming (`openspec:` prefix) scopes it to the OpenSpec feature without naming the caller.

## Goals / Non-Goals

**Goals:**
- Define `openspec:directory_hint` as the canonical contract for extensions to request OpenSpec polling of a directory other than `session.cwd`
- Handle it in `event-wiring.ts` generically — no knowledge of which plugin emitted it
- Trigger a forced (mtime-gate-bypassing) poll immediately on receipt
- Add the hinted path to the ongoing poll set so it continues to be polled

**Non-Goals:**
- Changing how `session.cwd` is registered (that path is correct for normal sessions)
- Any UI changes — the existing OpenSpec subcard renders automatically once the server broadcasts `openspec_update` for the new path
- Validation of the hinted path beyond what `refreshOpenSpec` already does (missing dir → no-op)
- Persisting hinted directories across server restarts (they re-hint on next session connect)

## Decisions

### 1. Event type name: `openspec:directory_hint`
**Decision**: Use `openspec:directory_hint` as the `eventType` in the forwarded event.

**Rationale**: Colon-namespaced event names are the existing convention in the codebase (`pi-dev-worktrees:workspace-switched`, `pi-dev-worktrees:bash-dispatch`, etc.). The `openspec:` prefix scopes it to the OpenSpec feature. `directory_hint` communicates that it is advisory — the server may already know the directory (no-op) or not (triggers poll). Alternative considered: `directory_hint` bare — rejected because it's too generic and doesn't communicate which server feature handles it.

### 2. Placement in `event-wiring.ts`
**Decision**: Add a new `if` block inside the `event_forward` handler, before the main store-insert path (same level as the `queue_state` early-return block).

**Rationale**: `queue_state` returns early because it's UI state, not history. `openspec:directory_hint` should also return early — it is a side-effect-only signal, not an event to be stored in the session event store or broadcast to browsers as a raw event. Storing it would pollute the event log with noise.

### 3. Use `refreshOpenSpec` (force mode)
**Decision**: Call `directoryService.refreshOpenSpec(path)` which bypasses the mtime gate.

**Rationale**: The hint arrives precisely when the user just activated a worktree — the directory is new to the server and the mtime gate would trivially skip it (no cached mtime → would actually run, but force-mode is clearer intent and matches user-initiated refresh semantics). `refreshOpenSpec` also adds the path to the ongoing poll cadence via `onDirectoryAdded` semantics inside `pollOne`.

### 4. Path validation
**Decision**: No validation beyond a truthy string check before calling `refreshOpenSpec`. Let `refreshOpenSpec` / `pollOne` handle missing/invalid paths gracefully (they already do — missing `openspec/` dir → broadcasts `{ initialized: false, pending: false, changes: [] }`).

**Rationale**: Keeping the handler thin. Adding `fs.existsSync` here would be redundant with what the poller already does.

### 5. Documentation in `protocol.ts`
**Decision**: Add a JSDoc comment block in `protocol.ts` documenting `openspec:directory_hint` as a supported `event_forward` `eventType`. No TypeScript type changes needed — `eventType` is already `string`.

**Rationale**: `protocol.ts` is the canonical reference for bridge↔server protocol. Future extension authors need to find this contract somewhere authoritative.

## Risks / Trade-offs

- **[Spam]** A misbehaving extension could emit `openspec:directory_hint` rapidly, causing many forced polls. Mitigation: `refreshOpenSpec` is already bounded by the `maxConcurrentSpawns` semaphore inside `pollOne`, so concurrent polls are capped. Rate-limiting at the event handler level is not needed now.
- **[Path traversal]** A malicious extension could hint an arbitrary path. Mitigation: the network guard (`localhost-guard.ts`) already gates REST endpoints; the bridge connection itself is trust-gated (only local pi sessions connect to port 9999). No additional guard needed.
