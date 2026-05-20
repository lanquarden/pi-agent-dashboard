## 1. Bridge: align notify with other patched methods

Spec: `specs/01-bridge-notify-opts.md`

- [x] 1.1 Update `ctx.ui.notify` patch in `packages/extension/src/bridge.ts`
  - Change signature: `(message, levelOrOpts?, _opts?)`
  - Normalise args: string → `{ level }`, object → direct
  - Extract `level`, `toolCallId`, `method` (default `"notify"`), `extraProps` (default `{}`)
  - Set `prompt.type = method` and `prompt.metadata = buildMeta({ toolCallId })`
  - Set `component: { type: method, props: { message, level, ...extraProps } }`
  - Still call `originalNotify?.(message, level)`
- [x] 1.2 Add `packages/extension/src/__tests__/bridge-notify-opts.test.ts`
  - `notify(message, level)` → prompt.type = `"notify"`, no metadata
  - `notify(message, { toolCallId, method, props })` → prompt.type = method, metadata.toolCallId set, component.props includes extra fields
  - `notify(message, { toolCallId })` only → method defaults to `"notify"`, metadata.toolCallId set

## 2. Plugin runtime: export registerInteractiveRenderer

Spec: `specs/02-plugin-runtime-export.md`

- [x] 2.1 Add to `packages/dashboard-plugin-runtime/src/index.ts`:
  - Re-export `registerInteractiveRenderer` from `../../client/src/components/interactive-renderers/registry.js`
  - Re-export type `InteractiveRenderer` and `InteractiveRendererProps` from `../../client/src/components/interactive-renderers/types.js`
- [x] 2.2 Add `packages/dashboard-plugin-runtime/src/__tests__/interactive-renderer-registration.test.ts`
  - `registerInteractiveRenderer` importable from barrel
  - Registering a renderer for `"test-method"` → `getInteractiveRenderer("test-method")` returns it
  - `getInteractiveRenderer("unknown")` still returns `GenericInteractiveRenderer`

## 3. BashDispatchRenderer

Spec: `specs/03-bash-dispatch-renderer.md`

- [x] 3.1 Create `packages/pi-dev-worktrees-plugin/src/client/BashDispatchRenderer.tsx`
  - Props via `params._promptBusComponent?.props` as `BashDispatchProps`
  - `status === "pending"`: render chip card (command + routing/RTK chips)
  - `status !== "pending"`: render `null`
  - Host chip gated on `hasDevcontainer === true`
  - Graceful null render on missing/malformed params
- [x] 3.2 Register in `packages/pi-dev-worktrees-plugin/src/client/index.tsx`:
  - Import `registerInteractiveRenderer` from `@blackbelt-technology/dashboard-plugin-runtime`
  - Call `registerInteractiveRenderer("bash-dispatch", BashDispatchRenderer)` at module top level
- [x] 3.3 Add `packages/pi-dev-worktrees-plugin/src/client/__tests__/BashDispatchRenderer.test.tsx`
  - container routing → container chip shown, no host chip
  - host routing + hasDevcontainer=true → host chip shown
  - host routing + hasDevcontainer=false → no host chip
  - rtkRewritten=true + rtkCommand → RTK chip shown with title=rtkCommand
  - routing=error + errorMessage → error chip with title=errorMessage
  - status=resolved → null
  - status=cancelled → null
  - missing params → null, no throw

## 4. Companion repo (pi-dev-worktrees)

Handoff spec: `specs/04-companion-pi-dev-worktrees.md`

Implementation is in the `pi-dev-worktrees` repo. Tasks here are coordination checkpoints:

- [x] 4.1 Confirm `tool_execution_start` hook available in pi-dev-worktrees extension API
- [x] 4.2 Implement in pi-dev-worktrees: capture `llmCommand` + `toolCallId` in `tool_execution_start`
- [x] 4.3 Implement in pi-dev-worktrees: emit `ctx.ui.notify(llmCommand, { toolCallId, method: "bash-dispatch", props: BashDispatchProps })` in `tool_call` handler
- [ ] 4.4 Integration test: end-to-end emission arrives at dashboard as `prompt_request` with correct `prompt.type` and `component.props`

## 5. Docs

- [x] 5.1 Add row to `docs/file-index-plugins.md` for `BashDispatchRenderer.tsx` and document the `plugin-card-replacement` pattern (emit `prompt_request` with `metadata.toolCallId` + `registerInteractiveRenderer`) as a supported plugin primitive
