## ADDED Requirements

### Requirement: `registerToolRenderer` exported from plugin runtime barrel

`packages/dashboard-plugin-runtime/src/index.ts` SHALL export `registerToolRenderer`, `getToolRenderer`, and the `ToolRendererProps` type so workspace plugins can replace built-in tool renderers. External MF plugins SHALL use `api.registerClaim({ slot: 'tool-renderer', ... })` instead (see `runtime-plugin-loading`), which delegates to `registerToolRenderer` internally.

#### Scenario: Workspace plugin registers tool renderer at module load

- **WHEN** a workspace plugin calls `registerToolRenderer("bash", MyRenderer)` at module-load time
- **THEN** `getToolRenderer("bash")` SHALL return `MyRenderer`.

#### Scenario: MF plugin registers via api.registerClaim

- **WHEN** an external MF plugin calls `api.registerClaim({ slot: 'tool-renderer', toolName: 'bash', component: MyRenderer })` in its `init()` function
- **THEN** `getToolRenderer("bash")` SHALL return `MyRenderer` (delegated internally to `registerToolRenderer`).

#### Scenario: Unknown tool returns undefined

- **WHEN** `getToolRenderer("unknown")` is called
- **THEN** it SHALL return `undefined`, and the client SHALL fall back to `GenericToolRenderer`.
