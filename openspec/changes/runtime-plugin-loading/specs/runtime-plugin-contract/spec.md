## ADDED Requirements

### Requirement: External plugins export `init(api)`

MF remote entries SHALL export a function `init(api: DashboardPluginApi): void | (() => void)`. The host SHALL call `init(api)` after importing the remote, and SHALL store the returned cleanup function.

#### Scenario: Plugin registers claims during init

- **WHEN** host calls `remote.init(api)` for pi-dev-worktrees
- **THEN** `init` SHALL call `api.registerClaim(...)` for each manifest claim.

#### Scenario: Init throws — error surfaced

- **WHEN** `init(api)` throws `Error("Missing dep")`
- **THEN** plugin status SHALL be set to `loaded: false` with error message. No partial claims SHALL be registered.

### Requirement: Runtime loader fetches manifests and loads remotes

A runtime loader at `packages/client/src/lib/plugin-loader.ts` SHALL:
1. On page load: `GET /api/plugins`, filter enabled plugins with `mfRemote`, load each remote entry as a `<script>`, discover the global container name, register the remote with the host's federation runtime via `registerRemotes`, then load the exposed module via `loadRemote` and call `init(api)`.
2. On `plugins_changed` WS event: diff against loaded set, load newly enabled, unload removed/disabled.
3. Track loaded plugins in `Map<id, { cleanup, claims[] }>`.

#### Scenario: Plugin loads without page refresh

- **WHEN** `plugins_changed` broadcast includes new plugin with `mfRemote`
- **THEN** loader SHALL load the remote via script injection + federation runtime, call init, and components SHALL render within ~2 seconds.

#### Scenario: Plugin unloads on removal

- **WHEN** `plugins_changed` omits a previously-loaded plugin
- **THEN** all unregister functions SHALL be called, claims SHALL be removed from registry, and components SHALL disappear.

### Requirement: Loading errors surfaced in PluginStatus

The loader SHALL preflight `HEAD` to `mfRemote` URL before loading the remote entry. Errors from script loading, federation runtime registration, or `init()` SHALL be caught and reported to `PluginStatusStore`. `<PluginsSection>` SHALL show a red "failed" badge with error text.

#### Scenario: 404 on remote entry

- **WHEN** `HEAD /plugins/broken/remoteEntry.js` returns 404
- **THEN** remote loading SHALL be skipped. Plugin SHALL show "Failed to load remote entry: 404" in UI.

### Requirement: Comprehensive unload

On unload, the host SHALL: call `init()` cleanup, all `registerClaim()` unregisters, all `onEvent()` and `subscribeSession()` unsubscribes, and remove all claims from registry by pluginId. Unload SHALL be idempotent.

#### Scenario: Double unload safe

- **WHEN** `unloadPlugin(id)` called twice
- **THEN** second call SHALL be a no-op. No errors SHALL be thrown.

### Requirement: SlotErrorBoundary catches remote failures

`SlotErrorBoundary` SHALL catch errors from dynamically-loaded remote components. On error, it SHALL log with plugin id and slot name, render a red error pill in dev (nothing in prod), and report the error to `PluginStatusStore`.

#### Scenario: Remote component throws — siblings survive

- **WHEN** slot `session-card-badge` has claims A, B, C and B's component throws
- **THEN** A and C SHALL still render. Only B SHALL be suppressed.
