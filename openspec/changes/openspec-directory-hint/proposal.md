## Why

The OpenSpec plugin polls directories for changes using the union of pinned directories and session `cwd` values. When a session starts in a main repo root but work moves to a different directory (e.g. a git worktree created mid-session by an extension like `pi-dev-worktrees`), the working directory diverges from `session.cwd`. The OpenSpec subcard never appears for the worktree because the server has no knowledge of it.

A generic, plugin-agnostic contract is needed so any extension can tell the server "start polling this directory for OpenSpec". Scoping it under `openspec:` keeps it semantically clear without coupling `event-wiring.ts` to any specific plugin's event namespace.

Triggering a poll alone is not enough. Four separate gaps must be closed:

1. **Poll result not broadcast** — `refreshOpenSpec` returns a `Promise<OpenSpecData>` that must be awaited and its result sent to browsers via `broadcastToAll({ openspec_update })`.
2. **Client map lookup mismatch** — the client looks up `openspecMap.get(session.cwd)` everywhere. After a hint the poll result is stored under the worktree path, not `session.cwd`. The session must carry `openspecCwd` so the client uses the right key.
3. **Periodic poll excludes hinted paths** — `computeKnownDirectories()` iterates only `session.cwd` and pinned dirs. The worktree path is polled once on hint but falls out of subsequent 30s ticks.
4. **File API security guard rejects worktree cwd** — `/api/file` validates that `cwd` matches a known `session.cwd`. Artifact file reads use the worktree path as `cwd` and are rejected as 403.

## What Changes

- **New `event_forward` handler** in `event-wiring.ts`: intercepts `openspec:directory_hint`, calls `directoryService.refreshOpenSpec(path)` (force-mode), broadcasts `openspec_update` with the poll result, and stores `openspecCwd: path` on the session.
- **`DashboardSession.openspecCwd`**: new optional field carrying the effective directory for OpenSpec lookups. When absent, falls back to `session.cwd`.
- **`computeKnownDirectories`** in `directory-service.ts`: also includes `session.openspecCwd` when set.
- **Client lookups** in `SessionList.tsx` and `App.tsx`: use `session.openspecCwd ?? session.cwd` for all openspec map lookups, `onReadArtifact`, and `onBulkArchive`.
- **`/api/file` guard** in `file-routes.ts`: allows `cwd` matching `session.openspecCwd` in addition to `session.cwd` and pinned directories.
- **Protocol documentation**: `openspec:directory_hint` documented in `protocol.ts`.

## Capabilities

### New Capabilities

- `openspec-directory-hint`: Generic contract allowing any bridge extension to emit `openspec:directory_hint { path: string }` via `pi.events.emit(...)`. The server intercepts the forwarded event, immediately triggers a forced OpenSpec poll, broadcasts the result to all browsers, records `openspecCwd` on the session, and adds the path to the ongoing poll cadence.

### Modified Capabilities

- `session-openspec-lookup`: Client OpenSpec map lookups, artifact reads, and bulk archive operations now use `session.openspecCwd ?? session.cwd`. Affects `SessionList.tsx` (sidebar cards — the attach dialog source) and `App.tsx` (desktop + mobile).
- `file-api-cwd-guard`: `/api/file` cwd allowlist extended to include `session.openspecCwd` values and pinned directories.

## Impact

- **Files**: `packages/server/src/event-wiring.ts`, `packages/server/src/directory-service.ts`, `packages/server/src/routes/file-routes.ts`, `packages/shared/src/types.ts`, `packages/shared/src/protocol.ts`, `packages/client/src/components/SessionList.tsx`, `packages/client/src/App.tsx`
- **Tests**: `packages/server/src/__tests__/event-wiring-openspec-directory-hint.test.ts`
- **Protocol**: New `eventType: "openspec:directory_hint"` in `event_forward`. New `openspecCwd?: string` on `DashboardSession`. Both backward compatible.
