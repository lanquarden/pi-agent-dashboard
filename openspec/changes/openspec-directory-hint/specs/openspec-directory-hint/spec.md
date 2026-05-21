## ADDED Requirements

### Requirement: Server handles openspec:directory_hint event
The server SHALL intercept `event_forward` messages where `eventType === "openspec:directory_hint"`, call `directoryService.refreshOpenSpec(path)`, broadcast the poll result via `broadcastToAll({ openspec_update })`, store `openspecCwd: path` on the session, broadcast `session_updated { openspecCwd }`, then return early without inserting the event into the session event store.

#### Scenario: Valid path hint triggers poll, broadcast, and session update
- **WHEN** a bridge extension emits `openspec:directory_hint { path: "/abs/path/to/worktree" }`
- **THEN** the server calls `directoryService.refreshOpenSpec("/abs/path/to/worktree")` in force mode
- **AND** `browserGateway.broadcastToAll({ type: "openspec_update", cwd: path, data })` is called with the poll result
- **AND** `session.openspecCwd` is set to `"/abs/path/to/worktree"`
- **AND** a `session_updated` message with `{ openspecCwd: "/abs/path/to/worktree" }` is broadcast to browsers
- **AND** the event is NOT inserted into the session event store

#### Scenario: Missing or empty path is a no-op
- **WHEN** a bridge extension emits `openspec:directory_hint {}` with no `path` field
- **THEN** the server does NOT call `directoryService.refreshOpenSpec`
- **AND** `session.openspecCwd` is NOT modified
- **AND** no error is thrown

#### Scenario: Duplicate hint is idempotent
- **WHEN** `openspec:directory_hint { path }` is received for a path already being polled
- **THEN** a forced refresh still runs and the result is broadcast
- **AND** `session.openspecCwd` is updated (same value, idempotent)
- **AND** no error is thrown

### Requirement: Hinted path included in periodic poll
`computeKnownDirectories()` in `directory-service.ts` SHALL include `session.openspecCwd` (when set) alongside `session.cwd` for every session.

#### Scenario: Worktree path polled on subsequent ticks
- **WHEN** `session.openspecCwd` is set to a worktree path
- **THEN** `computeKnownDirectories()` includes that path
- **AND** the periodic tick polls and broadcasts `openspec_update` for it on each interval

### Requirement: openspecCwd field on DashboardSession
`DashboardSession` in `packages/shared/src/types.ts` SHALL include `openspecCwd?: string`. When absent, clients SHALL fall back to `session.cwd` for all OpenSpec map lookups.

#### Scenario: openspecCwd absent — fallback to cwd
- **WHEN** a session has no `openspecCwd` field
- **THEN** the client uses `session.cwd` as the key for all openspec operations (unchanged behaviour)

#### Scenario: openspecCwd present — used for lookup
- **WHEN** a session has `openspecCwd` set to a worktree path
- **THEN** the client uses `session.openspecCwd` as the key for all `openspecMap` lookups for that session

### Requirement: Client uses openspecCwd for all openspec operations
The client SHALL resolve the OpenSpec directory as `session.openspecCwd ?? session.cwd` in all sites that interact with openspec data for a session.

Affected operations:
- `openspecMap` lookups for all props (`openspecChanges`, `openspecInitialized`, `openspecPending`, `openspecHasDir`, `openspecGroups`, `openspecAssignments`) in `SessionList.tsx` and `App.tsx`
- `onReadArtifact` cwd argument in `SessionList.tsx` and `App.tsx`
- `onBulkArchive` cwd argument in `SessionList.tsx`

#### Scenario: Sidebar attach dialog shows worktree changes
- **WHEN** a session has `openspecCwd` pointing to a worktree path
- **AND** `openspecMap` has an entry for that path with changes
- **THEN** the sidebar attach dialog shows those changes

#### Scenario: Artifact viewer loads worktree files
- **WHEN** a user clicks an artifact letter (P/D/S/T) on a session with `openspecCwd`
- **THEN** `onReadArtifact` is called with `session.openspecCwd` as the cwd
- **AND** the artifact preview loads successfully

#### Scenario: Sessions without openspecCwd unaffected
- **WHEN** a session has no `openspecCwd` field
- **THEN** all operations use `session.cwd` — behaviour identical to before this change

### Requirement: /api/file allows openspecCwd paths
`/api/file` in `file-routes.ts` SHALL allow requests where `cwd` matches any `session.openspecCwd` value (in addition to `session.cwd` and pinned directories). Requests with `cwd` matching none of these SHALL still be rejected 403.

#### Scenario: Artifact file read succeeds for worktree cwd
- **WHEN** a browser requests `/api/file?cwd=<worktreePath>&path=openspec/changes/...`
- **AND** a session exists with `openspecCwd === worktreePath`
- **THEN** the server returns 200 with the file content

#### Scenario: Unknown cwd still rejected
- **WHEN** a browser requests `/api/file?cwd=<arbitraryPath>&path=...`
- **AND** no session has `cwd` or `openspecCwd` matching `<arbitraryPath>`
- **AND** `<arbitraryPath>` is not a pinned directory
- **THEN** the server returns 403

### Requirement: openspec:directory_hint is documented in protocol.ts
`packages/shared/src/protocol.ts` SHALL include `OpenSpecDirectoryHintEventData` interface and JSDoc documenting the full server response: poll, `broadcastToAll`, and `openspecCwd` update.

#### Scenario: Protocol documentation present
- **WHEN** a developer reads `protocol.ts`
- **THEN** they find `OpenSpecDirectoryHintEventData` with payload shape, all server actions, and a usage example
