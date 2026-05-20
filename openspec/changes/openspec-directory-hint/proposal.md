## Why

The OpenSpec plugin polls directories for changes using the union of pinned directories and session `cwd` values. When a session starts in a main repo root but work moves to a different directory (e.g. a git worktree created mid-session by an extension like `pi-dev-worktrees`), the working directory diverges from `session.cwd`. The OpenSpec subcard never appears for the worktree because the server has no knowledge of it.

A generic, plugin-agnostic contract is needed so any extension can tell the server "start polling this directory for OpenSpec". Scoping it under `openspec:` keeps it semantically clear without coupling `event-wiring.ts` to any specific plugin's event namespace.

## What Changes

- **New `event_forward` handler** in `event-wiring.ts`: intercepts `openspec:directory_hint` events forwarded from bridge extensions and calls `directoryService.refreshOpenSpec(path)` (force-mode) for the hinted path.
- **Protocol documentation**: `openspec:directory_hint` is documented in `protocol.ts` as the supported event type for extensions to request OpenSpec polling of a directory other than their session `cwd`.

## Capabilities

### New Capabilities

- `openspec-directory-hint`: Generic contract allowing any bridge extension to emit `openspec:directory_hint { path: string }` via `pi.events.emit(...)`. The dashboard server intercepts the forwarded event and immediately triggers a forced OpenSpec poll for the given path, adding it to the set of known directories.

### Modified Capabilities

_(none)_

## Impact

- **Files**: `packages/server/src/event-wiring.ts`, `packages/shared/src/protocol.ts`
- **Tests**: `packages/server/src/__tests__/event-wiring.test.ts` (or equivalent)
- **Protocol**: New `eventType: "openspec:directory_hint"` in the bridge→server `event_forward` message. Payload: `{ path: string }`. Backward compatible — unknown event types are already ignored.
