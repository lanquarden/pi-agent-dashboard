## ADDED Requirements

### Requirement: Default model applied only to brand-new sessions

The bridge extension SHALL apply `config.defaultModel` (via `pi.setModel()`) only when the spawned pi process represents a brand-new session — i.e. when `ctx.sessionManager.getEntries().length === 0` at the time the bridge handles `session_start`. For sessions with existing entries (resumed via `--session`, forked via `--fork`, or reloaded mid-process), the bridge SHALL NOT call `pi.setModel()` and SHALL leave the session's existing model untouched.

This rule SHALL apply to both call sites of the default-model application:

1. The direct call inside the `session_start` handler.
2. The deferred retry path that fires when a previously-unavailable custom provider becomes ready after `session_start` (`pendingDefaultModel`).

The pre-existing gate on `event.reason === "startup"` SHALL remain in place; the entry-count check is an additional AND condition, not a replacement.

#### Scenario: Brand-new session gets default model

- **WHEN** the dashboard spawns pi without `--session` or `--fork` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.getEntries().length === 0`
- **AND** `config.defaultModel` is set and the model is resolvable in the model registry
- **THEN** the bridge SHALL call `pi.setModel()` with the resolved default model

#### Scenario: Resumed session keeps its existing model

- **WHEN** the dashboard spawns pi with `--session <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.getEntries().length > 0` (the session JSONL had prior entries)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the session SHALL continue with whatever model pi loaded from the persisted session

#### Scenario: Forked session inherits parent's model

- **WHEN** the dashboard spawns pi with `--fork <file>` and `session_start` fires with `reason === "startup"`
- **AND** `ctx.sessionManager.getEntries().length > 0` (parent entries copied by `SessionManager.forkFrom`)
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the forked session SHALL run with the model inherited from the parent session

#### Scenario: Bridge reload of in-flight session keeps model

- **WHEN** the bridge reloads (e.g. via `/reload`) while a session has prior entries
- **AND** `session_start` re-fires with `reason === "startup"`
- **AND** `ctx.sessionManager.getEntries().length > 0`
- **THEN** the bridge SHALL NOT call `pi.setModel()`

#### Scenario: Custom provider readiness retry respects the gate

- **WHEN** a brand-new session triggers default-model application but the configured model's provider is not yet registered, so `pendingDefaultModel` is set
- **AND** later the provider becomes ready and the retry fires
- **THEN** the bridge SHALL apply the default model

- **WHEN** a resumed or forked session reaches `session_start` and `pendingDefaultModel` is left null (because entries > 0)
- **AND** the provider becomes ready later
- **THEN** no default-model application SHALL occur

#### Scenario: Default model not configured

- **WHEN** any session starts and `config.defaultModel` is unset
- **THEN** the bridge SHALL NOT call `pi.setModel()` regardless of entry count
