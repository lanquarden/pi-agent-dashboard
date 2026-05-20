## 1. Plugin runtime: export registerToolRenderer

Spec: `specs/02-plugin-runtime-export.md`

- [x] 2.1 Export `registerToolRenderer` from `packages/dashboard-plugin-runtime/src/index.ts`
- [x] 2.2 Export type `ToolRendererProps` from barrel
- [ ] 2.3 Add test: `registerToolRenderer` importable from barrel, registered renderer returned by `getToolRenderer`

## 2. Client event reducer: handle bash-dispatch event_forward

Spec: `specs/03-bash-dispatch-renderer.md`

- [x] 3.1 In client event reducer, match `event_forward` with `eventType === "pi-dev-worktrees:bash-dispatch"`
- [x] 3.2 Extract `toolCallId` from payload, find matching tool row, patch `args._dispatch`
- [ ] 3.3 Add reducer test: event_forward patches correct tool row's `args._dispatch`

## 3. EnhancedBashToolRenderer

Spec: `specs/03-bash-dispatch-renderer.md`

- [x] 3.4 Create `packages/pi-dev-worktrees-plugin/src/client/EnhancedBashToolRenderer.tsx`
  - Read `args._dispatch` from tool renderer props
  - When present: render chip row (routing + RTK chips) above delegated `BashToolRenderer`
  - When absent: delegate to `BashToolRenderer` unchanged
  - Host chip gated on `hasDevcontainer === true`
- [x] 3.5 Register in `packages/pi-dev-worktrees-plugin/src/client/index.tsx`:
  - `registerToolRenderer("bash", EnhancedBashToolRenderer)`
- [ ] 3.6 Add `packages/pi-dev-worktrees-plugin/src/client/__tests__/EnhancedBashToolRenderer.test.tsx`
  - container routing → container chip shown
  - host routing + hasDevcontainer=true → host chip shown
  - host routing + hasDevcontainer=false → no host chip
  - rtkRewritten=true → RTK chip with title=rtkCommand
  - routing=error → error chip
  - no `_dispatch` → delegates to BashToolRenderer unchanged

## 4. Companion repo (pi-dev-worktrees)

Spec: `specs/04-companion-pi-dev-worktrees.md`

- [x] 4.1 Implement `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)` in `tool_call` handler
- [x] 4.2 Capture `llmCommand` in `tool_execution_start` handler
- [ ] 4.3 Integration test: event arrives at dashboard as `event_forward` with correct payload

## 5. Bridge notify opts (preserved for future use)

Spec: `specs/01-bridge-notify-opts.md`

- [x] 5.1 `ctx.ui.notify` opts extension implemented (backward-compatible)
- [x] 5.2 Tests passing
- Note: NOT used by bash-dispatch-chips. Preserved for future plugin use cases.
