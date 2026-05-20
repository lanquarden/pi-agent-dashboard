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
`computeKnownDirectories()` in `directory-service.ts` SHALL include `session.openspecCwd` (when set) alongside `session.cwd` for every session. This ensures the worktree path remains in the 30s periodic poll cadence after the initial hint.

#### Scenario: Worktree path polled on subsequent ticks
- **WHEN** `session.openspecCwd` is set to a worktree path
- **THEN** `computeKnownDirectories()` includes that path
- **AND** the periodic tick polls and broadcasts `openspec_update` for it on each interval

### Requirement: openspecCwd field on DashboardSession
`DashboardSession` in `packages/shared/src/types.ts` SHALL include `openspecCwd?: string`. When absent, clients SHALL fall back to `session.cwd` for all OpenSpec map lookups.

#### Scenario: openspecCwd absent — fallback to cwd
- **WHEN** a session has no `openspecCwd` field
- **THEN** the client uses `session.cwd` as the key for `openspecMap` lookups (unchanged behaviour)

#### Scenario: openspecCwd present — used for lookup
- **WHEN** a session has `openspecCwd` set to a worktree path
- **THEN** the client uses `session.openspecCwd` as the key for all `openspecMap` lookups for that session

### Requirement: Client uses openspecCwd for openspecMap lookups
The client SHALL resolve the OpenSpec map key as `session.openspecCwd ?? session.cwd` in all sites that pass openspec data to session card components.

Affected files:
- `packages/client/src/components/SessionList.tsx` — all four openspec props (`openspecChanges`, `openspecInitialized`, `openspecPending`, `openspecHasDir`) and both group map props (`openspecGroups`, `openspecAssignments`)
- `packages/client/src/App.tsx` — desktop `openspecChanges` prop and mobile actions `openspecChanges`

#### Scenario: Sidebar attach dialog shows worktree changes
- **WHEN** a session has `openspecCwd` pointing to a worktree path
- **AND** `openspecMap` has an entry for that path with changes
- **THEN** the sidebar attach dialog shows those changes

#### Scenario: Sidebar openspec subcard visibility uses openspecCwd
- **WHEN** rendering the sidebar `SessionCard` for a session with `openspecCwd`
- **THEN** `openspecInitialized`, `openspecPending`, `openspecHasDir` are resolved from `openspecMap.get(session.openspecCwd)`

#### Scenario: Desktop content pane openspecChanges uses openspecCwd
- **WHEN** rendering the desktop content pane for a session with `openspecCwd`
- **THEN** `openspecChanges` is resolved from `openspecMap.get(session.openspecCwd)`

#### Scenario: Mobile actions openspecChanges uses openspecCwd
- **WHEN** rendering mobile actions for a session with `openspecCwd`
- **THEN** `openspecChanges` is resolved from `openspecMap.get(session.openspecCwd)`

### Requirement: openspec:directory_hint is documented in protocol.ts
`packages/shared/src/protocol.ts` SHALL include a JSDoc comment documenting `openspec:directory_hint` as a supported `event_forward` `eventType`, its payload `{ path: string }`, and the full server response (poll + broadcast + `openspecCwd` update).

#### Scenario: Protocol documentation present
- **WHEN** a developer reads `protocol.ts`
- **THEN** they find `OpenSpecDirectoryHintEventData` interface and JSDoc covering payload shape, server actions, and the `openspecCwd` side-effect
