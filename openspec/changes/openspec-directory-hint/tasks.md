## 1. Protocol Documentation

- [x] 1.1 Add `OpenSpecDirectoryHintEventData` interface + JSDoc to `packages/shared/src/protocol.ts` documenting payload `{ path: string }`, server actions (poll + broadcast + `openspecCwd`), and usage example

## 2. Shared Types

- [x] 2.1 Add `openspecCwd?: string` to `DashboardSession` in `packages/shared/src/types.ts` with JSDoc

## 3. Server Handler

- [x] 3.1 In `packages/server/src/event-wiring.ts`, add early-return handler for `eventType === "openspec:directory_hint"`: extract `path`, guard on truthy string, call `directoryService.refreshOpenSpec(path)`, return early
- [x] 3.2 Chain `.then()` on `refreshOpenSpec` to call `browserGateway.broadcastToAll({ type: "openspec_update", cwd: hintedPath, data })` — without this the client never receives the poll result
- [x] 3.3 After `refreshOpenSpec`, call `sessionManager.update(sessionId, { openspecCwd: path })` and `browserGateway.broadcastSessionUpdated(sessionId, { openspecCwd: path })`

## 4. Periodic Poll

- [x] 4.1 In `packages/server/src/directory-service.ts`, extend `computeKnownDirectories()` to also add `session.openspecCwd` when set — keeps worktree path in the 30s tick after the initial hint

## 5. Client Lookups — SessionList.tsx (sidebar, critical path)

- [x] 5.1 Change all six openspec map lookups in `packages/client/src/components/SessionList.tsx` to use `session.openspecCwd ?? session.cwd`: `openspecChanges`, `openspecInitialized`, `openspecPending`, `openspecHasDir`, `openspecGroups`, `openspecAssignments`

## 6. Client Lookups — App.tsx (desktop + mobile)

- [x] 6.1 Change desktop `openspecChanges` prop in `packages/client/src/App.tsx` to use `openspecMap.get(selectedSession?.openspecCwd ?? selectedCwd)`
- [x] 6.2 Change mobile actions `openspecChanges` to use same pattern

## 7. Tests

- [x] 7.1 Test: `openspec:directory_hint` with valid path — event not stored in event store
- [x] 7.2 Test: missing/empty path — no-op, no error
- [x] 7.3 Test: `session.openspecCwd` is set to hinted path after valid hint
- [x] 7.4 Test: `session_updated` with `openspecCwd` is broadcast to browser subscribers
