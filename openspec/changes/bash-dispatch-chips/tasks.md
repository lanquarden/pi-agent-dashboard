## 1. Plugin runtime: export registerToolRenderer

Spec: `specs/02-plugin-runtime-export.md`

- [x] 2.1 Export `registerToolRenderer` from `packages/dashboard-plugin-runtime/src/index.ts`
- [x] 2.2 Export type `ToolRendererProps` from barrel
- [ ] 2.3 Add test: `registerToolRenderer` importable from barrel, registered renderer returned by `getToolRenderer`

## 2. Client event reducer: generic tool-row enrichment

Spec: `specs/03-bash-dispatch-renderer.md`

- [x] 3.1 Generic `event_forward` handler: any payload with `toolCallId` patches `args._pluginData[eventType]` on matching tool row
- [x] 3.2 Buffer in `pendingEnrichments` when tool row not yet created; flush on `tool_execution_start`
- [ ] 3.3 Add reducer tests (see spec 03)

## 3. EnhancedBashToolRenderer (plugin repo)

Spec: `specs/03-bash-dispatch-renderer.md` (plugin-specific rendering belongs in `pi-dev-worktrees` plugin repo)

- [x] 3.4 `EnhancedBashToolRenderer` created at `~/.pi/dashboard/plugins/pi-dev-worktrees/src/client/EnhancedBashToolRenderer.tsx`
- [x] 3.5 Registered via `registerToolRenderer("bash", EnhancedBashToolRenderer)` in plugin client entry
- [ ] 3.6 Tests for `EnhancedBashToolRenderer` (plugin repo, not this repo)

## 4. Companion repo (pi-dev-worktrees)

Spec: `specs/04-companion-pi-dev-worktrees.md`

- [x] 4.1 Implement `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` in `tool_call` handler
- [x] 4.2 Capture `llmCommand` in `tool_execution_start` handler
- [ ] 4.3 Integration test: event arrives at dashboard as `event_forward` with correct payload

## 5. Tool renderer header chips (opts.headerChips)

Spec: `specs/05-tool-renderer-header-chips.md`

- [x] 5.1 Extend `registerToolRenderer` with optional `opts.headerChips` parameter
- [x] 5.2 Add `getToolHeaderChips(toolName)` to registry
- [x] 5.3 `ToolCallStep.tsx` renders header chips via `getToolHeaderChips(toolName)?.(args)`
- [x] 5.4 Export `getToolHeaderChips` + `HeaderChipsFn` type from barrel
- [x] 5.5 Plugin registers `headerChips` function in `registerToolRenderer` call
- [x] 5.6 Tests: registry stores and returns header chips function

## 6. Bridge notify opts (reverted)

Spec: `specs/01-bridge-notify-opts.md`

- ~~6.1 `ctx.ui.notify` opts extension implemented (backward-compatible)~~ — reverted
- ~~6.2 Tests passing~~ — reverted
- Note: Implementation removed. Failed pathway. See spec 01 for rationale.
