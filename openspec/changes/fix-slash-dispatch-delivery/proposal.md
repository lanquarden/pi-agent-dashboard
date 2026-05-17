## Why

Two issues with the dashboard bridge's extension slash-command dispatch path:

**Issue 1 — dispatch hardcodes `streamingBehavior: "followUp"`.** When a dashboard user sends a steering message (Enter key during streaming), the bridge should route extension commands with `streamingBehavior: "steer"` so pi delivers them after the current turn's tool calls rather than queuing as followUp. But `tryDispatchExtensionCommand` hardcodes `"followUp"` and has no `delivery` parameter.

**Issue 2 — stopgap fires when `dispatchCommand` is not available.** Users on pi 0.74.1 see the stopgap error "requires pi 0.71+ (pi.dispatchCommand). Invoke from the pi TUI" when typing extension slash commands from the dashboard. The root cause: `dispatchCommand` **was never added to pi's ExtensionAPI** — it was a planned future API that did not ship. The bridge's Path D stopgap intercepts the slash command and shows an error, preventing pi from handling it natively. Pi 0.74+ already handles extension commands internally via its `prompt()` method (called by `sendUserMessage`), so the bridge should let those commands fall through to pi's native dispatch.

## What Changes

- **MODIFIED**: `packages/extension/src/slash-dispatch.ts` — `tryDispatchExtensionCommand` gains optional `delivery?: "steer" | "followUp"` parameter, used for `streamingBehavior` on the `dispatchCommand` call (Path B). Path D (stopgap) removed — instead returns `false` so the caller falls through to `pi.sendUserMessage`, where pi 0.74+ handles extension commands internally. Console warning added when `dispatchCommand` is unavailable (Path D).
- **MODIFIED**: `packages/extension/src/bridge.ts` — `sessionPrompt` callback gains `delivery` parameter, passed through to `tryDispatchExtensionCommand` and used as `deliverAs` on the `sendUserMessage` fallback.
- **MODIFIED**: `packages/extension/src/command-handler.ts` — `sessionPrompt` callback type updated to include `delivery` parameter. `msg.delivery` passed to `tryDispatchExtensionCommand` at the non-bridge call site (slash else-arm) for correct `streamingBehavior` propagation.
- **MODIFIED**: `packages/shared/src/protocol.ts` — `SendPromptToExtensionMessage` gains optional `delivery?: "steer" | "followUp"` field.
- **MODIFIED**: `packages/extension/src/bridge-context.ts` — `hasDispatchCommand` detection improved with `in`-operator fallback for getter-backed / Proxy-hidden properties.

## Capabilities

### Modified Capabilities

- `extension-slash-command-dispatch`: Path D stopgap removed. Non-headless extension commands now fall through to `pi.sendUserMessage` where pi's native `_tryExecuteExtensionCommand` dispatches them. No more false stopgap error.

## Impact

- **MODIFIED files** (implementation):
  - `packages/extension/src/slash-dispatch.ts` — delivery param + Path D removal
  - `packages/extension/src/bridge.ts` — delivery param plumbing
  - `packages/extension/src/command-handler.ts` — delivery param type + msg.delivery pass-through
  - `packages/shared/src/protocol.ts` — delivery field on `SendPromptToExtensionMessage`
  - `packages/extension/src/bridge-context.ts` — `hasDispatchCommand` improvement
- **MODIFIED files** (tests):
  - `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts` — delivery tests, Path D behavior update
  - `packages/extension/src/__tests__/command-handler.test.ts` — delivery propagation test
- **Backward compatibility**: Extension commands from the dashboard that previously got a stopgap error now work (pi dispatches internally). The `delivery` field on `SendPromptToExtensionMessage` is optional; clients that don't send it get `"followUp"` behavior (unchanged). Templates and non-extension slashes are unaffected.

## Depends On

- `fix-extension-slash-commands-in-dashboard` — establishes the slash-command routing order and `tryDispatchExtensionCommand` helper. This change fixes its Path D stopgap issue.
- `add-steering-message` (`feat/add-steering-message` branch) — adds `delivery` field to the protocol and `sessionPrompt` callback. This change wires `delivery` through to `tryDispatchExtensionCommand` for correct `streamingBehavior`.
