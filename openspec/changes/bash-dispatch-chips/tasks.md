## 1. Plugin runtime: export registerToolRenderer

Spec: `tool-renderer-registry`

- [x] 1.1 Export `registerToolRenderer`, `getToolRenderer` from `packages/dashboard-plugin-runtime/src/index.ts`
- [x] 1.2 Export types `ToolRendererProps`, `HeaderChipsFn`, `SummaryFn` from barrel
- [ ] 1.3 Test: `registerToolRenderer` importable, registered renderer returned by `getToolRenderer`

## 2. Client event reducer: generic tool-row enrichment

Spec: `tool-row-enrichment`

- [x] 2.1 Generic `event_forward` handler: any payload with `toolCallId` patches `args._pluginData[eventType]` on matching tool row
- [x] 2.2 `pendingEnrichments` buffer when tool row not yet created; flushed on `tool_execution_start`
- [ ] 2.3 Reducer tests: `event_forward` patches correct row, buffer+flush works, cap at 20 evicts oldest

## 3. EnhancedBashToolRenderer (plugin repo)

Spec: `bash-dispatch-plugin`

- [ ] 3.1 `EnhancedBashToolRenderer` with routing/RTK chip rendering (in `pi-dev-worktrees-dashboard-plugin` repo)
- [ ] 3.2 Registered via `api.registerClaim({ slot: 'tool-renderer', ... })` in MF `init(api)` function
- [ ] 3.3 Tests for `EnhancedBashToolRenderer` (plugin repo)

## 4. Companion repo (pi-dev-worktrees extension)

Spec: `bash-dispatch-plugin`

- [x] 4.1 `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` in `tool_call` handler
- [x] 4.2 Capture `llmCommand` in `tool_execution_start` handler
- [ ] 4.3 Integration test: event arrives at dashboard as `event_forward` with correct payload

## 5. Tool renderer header chips (opts.headerChips)

Spec: `tool-renderer-header-chips`

- [x] 5.1 Extend `registerToolRenderer` with optional `opts: { headerChips?, summary? }` parameter
- [x] 5.2 Add `getToolHeaderChips(toolName)` and `getToolSummary(toolName)` to registry
- [x] 5.3 `ToolCallStep.tsx` renders header chips via `getToolHeaderChips(toolName)?.(args)`
- [x] 5.4 Export `getToolHeaderChips`, `getToolSummary`, `HeaderChipsFn`, `SummaryFn` from barrel
- [x] 5.5 `ToolCallStep.tsx` `getSummary()` prefers plugin summary override
- [x] 5.6 Tests: registry stores and returns header chips function

## 6. Vite plugin: toolRenderers manifest support

Spec: `tool-renderer-registry`

- [x] 6.1 `PluginEntry` gains `toolRenderers?: Array<{ toolName: string; component: string }>`
- [x] 6.2 `loadPluginEntries` parses `toolRenderers` from `pi-dashboard-plugin` in `package.json`
- [x] 6.3 `generateRegistryContent` imports toolRenderer components and emits `registerToolRenderer()` calls
