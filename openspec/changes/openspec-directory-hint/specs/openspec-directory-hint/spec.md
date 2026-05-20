## ADDED Requirements

### Requirement: Server handles openspec:directory_hint event
The server SHALL intercept `event_forward` messages where `eventType === "openspec:directory_hint"` and call `directoryService.refreshOpenSpec(path)` with the hinted path, store `openspecCwd: path` on the session, broadcast a `session_updated` with `openspecCwd`, then return early without inserting the event into the session event store.

#### Scenario: Valid path hint triggers forced poll and updates session
- **WHEN** a bridge extension emits `openspec:directory_hint { path: "/abs/path/to/worktree" }`
- **THEN** the server calls `directoryService.refreshOpenSpec("/abs/path/to/worktree")` in force mode
- **AND** `session.openspecCwd` is set to `"/abs/path/to/worktree"`
- **AND** a `session_updated` message with `{ openspecCwd: "/abs/path/to/worktree" }` is broadcast to browsers
- **AND** the event is NOT inserted into the session event store

#### Scenario: Missing or empty path is a no-op
- **WHEN** a bridge extension emits `openspec:directory_hint {}` with no `path` field
- **THEN** the server does NOT call `directoryService.refreshOpenSpec`
- **AND** `session.openspecCwd` is NOT modified
- **AND** the handler returns without error

#### Scenario: Hinted path is added to ongoing poll set
- **WHEN** `openspec:directory_hint { path }` is received for a path not currently polled
- **THEN** subsequent periodic poll ticks include the hinted path
- **AND** the server broadcasts `openspec_update` for that path within one poll interval

#### Scenario: Duplicate hint is idempotent
- **WHEN** `openspec:directory_hint { path }` is received for a path already being polled
- **THEN** a forced refresh still runs
- **AND** `session.openspecCwd` is updated (idempotent same value)
- **AND** no error is thrown

### Requirement: openspecCwd field on DashboardSession
`DashboardSession` in `packages/shared/src/types.ts` SHALL include `openspecCwd?: string`. When absent, clients SHALL fall back to `session.cwd` for all OpenSpec map lookups.

#### Scenario: openspecCwd absent — fallback to cwd
- **WHEN** a session has no `openspecCwd` field
- **THEN** the client uses `session.cwd` as the key for `openspecMap` lookups (unchanged behaviour)

#### Scenario: openspecCwd present — used for lookup
- **WHEN** a session has `openspecCwd` set to a worktree path
- **THEN** the client uses `session.openspecCwd` as the key for all `openspecMap` lookups for that session

### Requirement: openspec:directory_hint is documented in protocol.ts
`packages/shared/src/protocol.ts` SHALL include a JSDoc comment documenting `openspec:directory_hint` as a supported `event_forward` `eventType`, its payload `{ path: string }`, and the server's response (poll + openspecCwd update).

#### Scenario: Protocol documentation present
- **WHEN** a developer reads `protocol.ts`
- **THEN** they find documentation for `openspec:directory_hint` including the `openspecCwd` side-effect

## ADDED Requirements

### Requirement: Client uses openspecCwd for openspecMap lookups
The client SHALL resolve the OpenSpec map key as `session.openspecCwd ?? session.cwd` in all sites that pass `openspecChanges` to session card and action components.

#### Scenario: Attach dialog shows worktree changes
- **WHEN** a session has `openspecCwd` pointing to a worktree path
- **AND** `openspecMap` has an entry for that path with changes
- **THEN** the attach dialog shows those changes

#### Scenario: Desktop session card openspecChanges uses openspecCwd
- **WHEN** rendering the desktop `SessionCard` for a session with `openspecCwd`
- **THEN** `openspecChanges` is resolved from `openspecMap.get(session.openspecCwd)`

#### Scenario: Mobile actions openspecChanges uses openspecCwd
- **WHEN** rendering mobile actions for a session with `openspecCwd`
- **THEN** `openspecChanges` is resolved from `openspecMap.get(session.openspecCwd)`
