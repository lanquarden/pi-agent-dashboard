## 1. Protocol Documentation

- [x] 1.1 Add `OpenSpecDirectoryHintEventData` interface + JSDoc to `packages/shared/src/protocol.ts` documenting payload `{ path: string }`, all server actions (poll + broadcast + `openspecCwd`), and usage example

## 2. Shared Types

- [x] 2.1 Add `openspecCwd?: string` to `DashboardSession` in `packages/shared/src/types.ts` with JSDoc

## 3. Server Handler

- [x] 3.1 In `packages/server/src/event-wiring.ts`, add early-return handler for `eventType === "openspec:directory_hint"`: extract `path`, guard on truthy string, call `directoryService.refreshOpenSpec(path)`, return early
- [x] 3.2 Chain `.then()` on `refreshOpenSpec` to call `browserGateway.broadcastToAll({ type: "openspec_update", cwd: hintedPath, data })`
- [x] 3.3 Call `sessionManager.update(sessionId, { openspecCwd: path })` and `browserGateway.broadcastSessionUpdated(sessionId, { openspecCwd: path })`

## 4. Periodic Poll

- [x] 4.1 In `packages/server/src/directory-service.ts`, extend `computeKnownDirectories()` to also add `session.openspecCwd` when set

## 5. Client Lookups — SessionList.tsx (sidebar, critical path)

- [x] 5.1 All six openspec map lookups use `session.openspecCwd ?? session.cwd`: `openspecChanges`, `openspecInitialized`, `openspecPending`, `openspecHasDir`, `openspecGroups`, `openspecAssignments`
- [x] 5.2 `onReadArtifact` passes `session.openspecCwd ?? session.cwd` as the cwd argument
- [x] 5.3 `onBulkArchive` passes `session.openspecCwd ?? session.cwd` as the cwd argument

## 6. Client Lookups — App.tsx (desktop + mobile)

- [x] 6.1 Desktop `openspecChanges` prop uses `openspecMap.get(selectedSession?.openspecCwd ?? selectedCwd)`
- [x] 6.2 Mobile actions `openspecChanges` uses same pattern
- [x] 6.3 Desktop `onReadArtifact` passes `selectedSession?.openspecCwd ?? selectedCwd`
- [x] 6.4 Mobile `onReadArtifact` passes `selectedSession?.openspecCwd ?? selectedCwd`

## 7. File API Guard

- [x] 7.1 In `packages/server/src/routes/file-routes.ts`, extend `/api/file` cwd allowlist to include `session.openspecCwd` values and pinned directories alongside `session.cwd`

## 8. Tests

- [x] 8.1 Test: `openspec:directory_hint` with valid path — event not stored in event store
- [x] 8.2 Test: missing/empty path — no-op, no error
- [x] 8.3 Test: `session.openspecCwd` is set to hinted path after valid hint
- [x] 8.4 Test: `session_updated` with `openspecCwd` is broadcast to browser subscribers
