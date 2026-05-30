## ADDED Requirements

### Requirement: pi-dev-worktrees emits structured bash-dispatch events

The pi-dev-worktrees extension SHALL emit `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` from its `tool_call` handler after bash routing. The payload SHALL contain `toolCallId`, `llmCommand`, `rtkRewritten`, `rtkCommand` (when rewritten), `routing` ("host" | "container" | "error"), and `hasDevcontainer`. The bridge SHALL forward this as `event_forward` automatically via existing flow-event wiring.

#### Scenario: Bash command routed to devcontainer

- **WHEN** pi-dev-worktrees routes a bash command to a devcontainer
- **THEN** the emitted event SHALL have `routing: "container"` and `hasDevcontainer: true`.

#### Scenario: RTK rewrites command

- **WHEN** pi-rtk-optimizer rewrites the LLM command before routing
- **THEN** the emitted event SHALL have `rtkRewritten: true` and `rtkCommand` set to the rewritten command.

### Requirement: Dashboard plugin loads as MF remote

The dashboard plugin (`@lanquarden/pi-dev-worktrees-dashboard-plugin`) SHALL be an MF remote loaded at runtime via `runtime-plugin-loading`. It SHALL export an `init(api)` function that calls `api.registerClaim({ slot: 'tool-renderer', toolName: 'bash', component: EnhancedBashRenderer, headerChips: renderBashDispatchChips })`. The pi extension event emission path is unchanged.

#### Scenario: Plugin registers via MF init

- **WHEN** the dashboard host loads the plugin remote and calls `init(api)`
- **THEN** the plugin SHALL call `api.registerClaim()` for its tool-renderer claim with `headerChips` and the enhanced renderer.

#### Scenario: Plugin reads enrichment data from args

- **WHEN** `EnhancedBashRenderer` renders a bash tool row
- **THEN** it SHALL read `args._pluginData?.["pi-dev-worktrees:bash-dispatch"]` to get routing/RTK metadata for chip rendering.
