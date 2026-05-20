## 1. Protocol Documentation

- [x] 1.1 Add JSDoc comment to `packages/shared/src/protocol.ts` documenting `openspec:directory_hint` as a supported `event_forward` `eventType` with payload `{ path: string }` and description of server behaviour

## 2. Server Handler

- [x] 2.1 In `packages/server/src/event-wiring.ts`, inside the `event_forward` handler block, add an early-return `if` for `eventType === "openspec:directory_hint"`: extract `path` from `msg.event.data`, guard on truthy string, call `directoryService.refreshOpenSpec(path)`, and `return`
- [x] 2.2 Verify the new block is positioned before the store-insert path (same level as the `queue_state` early-return)

## 3. Tests

- [x] 3.1 Add test for the happy path: `openspec:directory_hint` with valid `path` calls `refreshOpenSpec` and does not insert into event store
- [x] 3.2 Add test for missing/empty `path`: no `refreshOpenSpec` call, no error thrown
