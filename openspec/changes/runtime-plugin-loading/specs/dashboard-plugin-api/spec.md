## ADDED Requirements

### Requirement: `DashboardPluginApi` typed interface

The `DashboardPluginApi` interface SHALL be defined in `packages/shared/src/dashboard-plugin/api.ts`. It SHALL expose: `registerClaim(claim)`, `getSession(id)`, `getAllSessions()`, `subscribeSession(fn)`, `onEvent(type, fn)`, `showToast(msg, variant?)`, `getConfig<T>()`, `setConfig(partial)`, and `readonly pluginId`. Every registration method SHALL return an unregister function.

#### Scenario: Claim registered and unregistered

- **WHEN** plugin calls `api.registerClaim({ slot: 'session-card-badge', component: Badge })`
- **THEN** badge SHALL render. When returned fn called, badge SHALL disappear.

#### Scenario: Session data accessed

- **WHEN** plugin calls `api.getSession('abc')` and session exists
- **THEN** return value SHALL be a `DashboardSession` with all fields.

#### Scenario: Event subscription filtered by type

- **WHEN** plugin subscribes to `'pi-dev-worktrees:state'` and `session_updated` fires
- **THEN** callback SHALL NOT be invoked (type mismatch).

#### Scenario: Config round-trip

- **WHEN** plugin calls `api.setConfig({ theme: 'dark' })` then `api.getConfig()`
- **THEN** second call SHALL return `{ theme: 'dark' }`.

### Requirement: `registerClaim` validates inputs

`registerClaim` SHALL throw `TypeError` for invalid `slot` id (not in `SLOT_DEFINITIONS`). It SHALL throw if `component` is missing for React-component slots.

#### Scenario: Invalid slot throws

- **WHEN** plugin calls `registerClaim({ slot: 'bogus', component: X })`
- **THEN** call SHALL throw `TypeError` listing valid slots.

### Requirement: `registerClaim` delegates to existing APIs for tool-renderer slot

When `registerClaim` receives a `slot: 'tool-renderer'` claim with `toolName` and `component`, the implementation SHALL internally call `registerToolRenderer(toolName, component)` (existing API from `fix/tool-renderer-header-chips`). Optional `headerChips` and `summary` functions in the claim SHALL be passed as the `opts` parameter. On cleanup (unregister), the renderer SHALL be removed from the registry and the original built-in renderer restored.

#### Scenario: Tool renderer registered via claim

- **WHEN** plugin calls `api.registerClaim({ slot: 'tool-renderer', toolName: 'bash', component: EnhancedBash, headerChips: myChips })`
- **THEN** `getToolRenderer('bash')` SHALL return `EnhancedBash` and `getToolHeaderChips('bash')` SHALL return `myChips`.

### Requirement: `createDashboardPluginApi` factory

A factory function `createDashboardPluginApi(deps, pluginId)` SHALL be implemented in `packages/client/src/lib/plugin-api.ts`. It SHALL scope all registrations per `pluginId` and SHALL track them for cleanup on unload. It SHALL include the `registerToolRenderer` delegation described above.

#### Scenario: All registrations cleaned up

- **WHEN** plugin unloaded after registering 3 claims and 2 event listeners
- **THEN** all 5 unregister functions SHALL be called. No plugin code SHALL remain active.
