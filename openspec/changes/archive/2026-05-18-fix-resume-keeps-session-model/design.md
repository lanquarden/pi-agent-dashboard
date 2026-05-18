## Context

`packages/extension/src/bridge.ts` applies `config.defaultModel` via `pi.setModel()` whenever a pi process emits its first `session_start` with `reason === "startup"`. The fallback `"startup"` reason fires for every pi cold start regardless of whether `--session <file>` or `--fork <file>` was passed (verified in `pi-coding-agent/dist/core/agent-session.js:128`). The dashboard always spawns pi as a fresh process for resume and fork (`packages/server/src/process-manager.ts` `sessionFlagsToArgv`), so the bridge unconditionally overwrites the persisted model on every resume and fork.

Pi's own CLI gates its native default-model logic on `!hasExistingSession` (`pi-coding-agent/dist/main.js` `buildSessionOptions`), where `hasExistingSession = sessionManager.buildSessionContext().messages.length > 0`. The bridge bypasses that gate by running after pi has already initialised the session.

## Goals / Non-Goals

**Goals:**
- Apply `config.defaultModel` only for sessions that have no prior history.
- Mirror pi's native `hasExistingSession` semantics so fork inherits the parent's model and resume keeps the session's model.
- Keep the fix surgical — bridge-only, no protocol / server / CLI changes.

**Non-Goals:**
- Re-architecting how `config.defaultModel` is delivered to pi (still post-spawn via `pi.setModel()`).
- Persisting model in the dashboard's `.meta.json` sidecar as the authoritative source.
- Changing pi CLI argv (no new `--model` flag from the dashboard).

## Decisions

### Decision 1: Detection signal = `sessionManager.getEntries().length === 0`

The bridge gates default-model application on the session's entry count at `session_start`.

| Spawn case | `entries.length` | Action |
|---|---|---|
| New (`SessionManager.create`) | 0 | Apply default |
| Resume (`--session`) | >0 | Keep model |
| Fork (`--fork`, via `SessionManager.forkFrom`) | >0 (parent entries copied) | Keep parent's model |
| Bridge reload of in-flight session | >0 | Keep current model |

**Alternatives considered:**
- `readSessionMeta(sessionFile)?.model` (dashboard sidecar): fragile — depends on model-tracker having recorded a model previously; meta may be absent for older sessions.
- `ctx.sessionManager.getSessionFile?.() === undefined`: doesn't work — pi creates a session file immediately even for brand-new sessions.
- pi's `event.reason === "new"`: only fires for **in-process** new-session transitions (`/new`). Cold-start with no flags emits `"startup"`, so this misses the primary new-session path.

**Why `getEntries().length === 0` wins:**
- Single signal handles all four cases correctly.
- Matches pi's own internal rule (`!hasExistingSession`) → behaviour stays consistent with pi's CLI semantics for free.
- No reliance on dashboard sidecar state.
- Cheap — `getEntries()` is already populated synchronously by the time `session_start` fires.

### Decision 2: Apply gate to both call sites

`applyDefaultModel()` is called from two places in `bridge.ts`:

1. Direct call at `session_start` (~L1462).
2. Retry via `pendingDefaultModel` when a custom provider becomes ready later (~L1693-1694).

Both sites must be gated. Cleanest implementation: capture `isFreshSession` once at the top of the `session_start` handler and use it for both the initial call and any future retry (by leaving `pendingDefaultModel = null` for non-fresh sessions, the retry path is naturally inert).

### Decision 3: Keep the existing `reason === "startup"` check

The existing `_event?.reason === "startup"` gate already correctly excludes in-process `/new`, `/fork`, `/resume`, and `/reload` reasons (pi sets these explicitly). The new entry-count check is an **additional** AND condition, not a replacement.

## Risks / Trade-offs

- **Risk**: A new session that crashes pi mid-startup before any entry is appended could in theory be respawned and re-apply the default. → Mitigation: this is the desired behaviour for a session with no history; identical to a brand-new spawn.
- **Risk**: Future pi versions could change when entries become visible to `getEntries()`. → Mitigation: pi's `buildSessionContext().messages.length` is on the same code path; if pi changes it for itself, the bridge will pick up the same semantics.
- **Trade-off**: Users who want "always force my default model on resume" lose that behaviour. → Acceptable; the existing behaviour was an unintended side-effect, not a documented feature. If demand surfaces, a separate config flag (`forceDefaultModelOnResume: boolean`) can be added later — out of scope here.

## Migration Plan

No migration. Behaviour change takes effect on bridge reload. Existing `.meta.json#model` writes from `model-tracker.ts` remain valid and continue to populate the dashboard UI; this change only affects which model pi runs with.
