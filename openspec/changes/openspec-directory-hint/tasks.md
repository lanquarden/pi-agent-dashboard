## 1. Protocol Documentation

- [x] 1.1 Add JSDoc comment to `packages/shared/src/protocol.ts` documenting `openspec:directory_hint` as a supported `event_forward` `eventType` with payload `{ path: string }` and description of server behaviour including `openspecCwd` side-effect

## 2. Shared Types

- [x] 2.1 Add `openspecCwd?: string` to `DashboardSession` in `packages/shared/src/types.ts` with a JSDoc comment explaining it is the effective OpenSpec poll directory, falls back to `cwd` when absent

## 3. Server Handler

- [x] 3.1 In `packages/server/src/event-wiring.ts`, inside the `event_forward` handler block, add an early-return `if` for `eventType === "openspec:directory_hint"`: extract `path`, guard on truthy string, call `directoryService.refreshOpenSpec(path)`, and `return`
- [x] 3.2 After `refreshOpenSpec`, call `sessionManager.update(sessionId, { openspecCwd: path })` and `browserGateway.broadcastSessionUpdated(sessionId, { openspecCwd: path })`

## 4. Client Lookups

- [x] 4.1 In `packages/client/src/App.tsx`, change both `openspecMap.get(selectedCwd)` calls to use `openspecMap.get(selectedSession?.openspecCwd ?? selectedCwd)`

## 5. Tests

- [x] 5.1 Test: `openspec:directory_hint` with valid `path` — event not stored in event store
- [x] 5.2 Test: missing/empty `path` — no-op, no error
- [x] 5.3 Extend test: verify `session.openspecCwd` is set to hinted path after valid hint
- [x] 5.4 Extend test: verify `session_updated` broadcast contains `openspecCwd`
