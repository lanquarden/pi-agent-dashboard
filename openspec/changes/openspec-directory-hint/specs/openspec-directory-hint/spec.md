## ADDED Requirements

### Requirement: Server handles openspec:directory_hint event
The server SHALL intercept `event_forward` messages where `eventType === "openspec:directory_hint"` and call `directoryService.refreshOpenSpec(path)` with the hinted path, then return early without inserting the event into the session event store.

#### Scenario: Valid path hint triggers forced poll
- **WHEN** a bridge extension emits `openspec:directory_hint { path: "/abs/path/to/worktree" }`
- **THEN** the server calls `directoryService.refreshOpenSpec("/abs/path/to/worktree")` in force mode
- **AND** the event is NOT inserted into the session event store
- **AND** the event is NOT broadcast to browsers as a raw event

#### Scenario: Missing or empty path is a no-op
- **WHEN** a bridge extension emits `openspec:directory_hint {}` with no `path` field
- **THEN** the server does NOT call `directoryService.refreshOpenSpec`
- **AND** the handler returns without error

#### Scenario: Hinted path is added to ongoing poll set
- **WHEN** `openspec:directory_hint { path }` is received for a path not currently polled
- **THEN** subsequent periodic poll ticks include the hinted path
- **AND** the server broadcasts `openspec_update` for that path within one poll interval

#### Scenario: Duplicate hint is idempotent
- **WHEN** `openspec:directory_hint { path }` is received for a path already being polled
- **THEN** a forced refresh still runs (consistent with `refreshOpenSpec` force-mode semantics)
- **AND** no error is thrown

### Requirement: openspec:directory_hint is documented in protocol.ts
The `packages/shared/src/protocol.ts` file SHALL include a JSDoc comment documenting `openspec:directory_hint` as a supported `event_forward` `eventType`, with its payload shape `{ path: string }` and intended use.

#### Scenario: Protocol documentation present
- **WHEN** a developer reads `protocol.ts`
- **THEN** they find documentation for `openspec:directory_hint` explaining the payload and the server's response
