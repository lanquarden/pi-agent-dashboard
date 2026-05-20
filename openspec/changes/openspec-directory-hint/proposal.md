## Why

The OpenSpec plugin polls directories for changes using the union of pinned directories and session `cwd` values. When a session starts in a main repo root but work moves to a different directory (e.g. a git worktree created mid-session by an extension like `pi-dev-worktrees`), the working directory diverges from `session.cwd`. The OpenSpec subcard never appears for the worktree because the server has no knowledge of it.

A generic, plugin-agnostic contract is needed so any extension can tell the server "start polling this directory for OpenSpec". Scoping it under `openspec:` keeps it semantically clear without coupling `event-wiring.ts` to any specific plugin's event namespace.

However, triggering a poll is not enough on its own. The client looks up `openspecMap.get(session.cwd)` to populate the attach dialog and session card. When OpenSpec changes live in a worktree at a path different from `session.cwd`, the map lookup always misses — the polling result is stored under the worktree path, not the session cwd. The session needs to carry its **effective OpenSpec directory** so the client can look up the right entry.

## What Changes

- **New `event_forward` handler** in `event-wiring.ts`: intercepts `openspec:directory_hint` events, calls `directoryService.refreshOpenSpec(path)` (force-mode), and stores `openspecCwd: path` on the session so the client knows where to look.
- **`DashboardSession.openspecCwd`**: new optional field carrying the effective directory for OpenSpec lookups. When absent, falls back to `session.cwd` (existing behaviour for all sessions without a hint).
- **Client lookups**: everywhere the client reads `openspecMap.get(session.cwd)` it instead reads `openspecMap.get(session.openspecCwd ?? session.cwd)`.
- **Protocol documentation**: `openspec:directory_hint` is documented in `protocol.ts`.

## Capabilities

### New Capabilities

- `openspec-directory-hint`: Generic contract allowing any bridge extension to emit `openspec:directory_hint { path: string }` via `pi.events.emit(...)`. The dashboard server intercepts the forwarded event, immediately triggers a forced OpenSpec poll for the given path, and records `openspecCwd` on the session so the client resolves the correct `openspecMap` entry.

### Modified Capabilities

- `session-openspec-lookup`: Client OpenSpec map lookups now use `session.openspecCwd ?? session.cwd` as the key instead of always `session.cwd`. Affects `SessionCard`, `SessionOpenSpecActions`, `App.tsx` openspecChanges prop, and the mobile header path.

## Impact

- **Files**: `packages/server/src/event-wiring.ts`, `packages/shared/src/types.ts`, `packages/shared/src/protocol.ts`, `packages/client/src/App.tsx`, `packages/client/src/components/SessionCard.tsx` (if it reads cwd directly)
- **Tests**: `packages/server/src/__tests__/event-wiring-openspec-directory-hint.test.ts` (extend), client tests for openspecCwd fallback
- **Protocol**: New `eventType: "openspec:directory_hint"` in `event_forward`. New `openspecCwd?: string` field in `DashboardSession` and `session_updated` messages. Both backward compatible.
