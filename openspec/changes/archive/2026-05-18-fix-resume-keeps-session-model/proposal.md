## Why

The bridge force-applies `config.defaultModel` via `pi.setModel()` on every pi-process startup, including resumed and forked sessions. This overwrites the model the user previously chose for that session. Pi's own CLI gates its default-model logic on `!hasExistingSession`; the dashboard bypasses that gate by applying defaults post-spawn from the bridge.

## What Changes

- Gate `applyDefaultModel()` in `packages/extension/src/bridge.ts` on `sessionManager.getEntries().length === 0` in addition to the existing `event.reason === "startup"` check.
- Same gate guards the `pendingDefaultModel` retry path (fires when a custom provider becomes ready after session_start).
- No protocol changes. No CLI changes. No server changes.

Resulting behaviour matrix:

| Spawn case | `entries.length` at session_start | Action |
|---|---|---|
| New (`SessionManager.create`) | 0 | Apply `config.defaultModel` |
| Resume (`--session <file>`) | >0 | Keep session's existing model |
| Fork (`--fork <file>`) | >0 (parent entries copied) | Keep parent's model |
| Bridge reload of in-flight session | >0 | Keep current model |

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `bridge-extension`: tighten the default-model application rule. The bridge SHALL apply `config.defaultModel` only when the spawned pi process has zero session entries at `session_start`. Resumed, forked, and reloaded sessions SHALL keep their existing model.

## Impact

- **Code**: `packages/extension/src/bridge.ts` (default-model gate at lines ~1461-1464 and the retry at ~1693-1694).
- **Behaviour**: Resumed and forked sessions stop having their model silently overwritten on every spawn. Aligns the dashboard with pi's native `hasExistingSession` semantics.
- **APIs / protocol**: unchanged.
- **Persistence**: unchanged. `.meta.json#model` is no longer needed as a fallback signal — the session JSONL itself is authoritative via `getEntries()`.
- **Risk**: low. A new session with zero entries still gets the default. The only behaviour change is "resume/fork no longer overwrites".
