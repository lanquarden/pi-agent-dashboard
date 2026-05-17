## Context

The dashboard bridge's slash-command dispatch path (`slash-dispatch.ts`) routes extension commands through three paths:

- **Path B**: `pi.dispatchCommand(text, { streamingBehavior })` — planned pi 0.71+ API. Never shipped.
- **Path C**: server-routed dispatch via RPC keeper UDS — headless sessions only.
- **Path D** (stopgap): emits error telling user to use pi TUI — fires when neither B nor C is available.

The `sessionPrompt` callback in `bridge.ts` receives a `delivery` parameter (from `add-steering-message`) but `tryDispatchExtensionCommand` does not accept or use it.

## Goals / Non-Goals

**Goals**

- Pass `delivery` through to `tryDispatchExtensionCommand` so Path B uses correct `streamingBehavior` ("steer" vs "followUp").
- Fix the Path D stopgap so extension commands work in non-headless sessions (tmux/wt) on pi 0.74+.
- Keep Path B and Path C unchanged in behavior when `delivery` is absent.

**Non-Goals**

- Remove Path B or Path C.
- Add a new dispatch mechanism.
- Change the PromptQueue or queue_state protocol.

## Decisions

### Decision 1: Path D returns `false` instead of emitting stopgap error

**Problem**: `dispatchCommand` was a planned pi API for 0.71+ that never shipped. The bridge's Path D stopgap intercepts extension slash commands and shows an error, preventing pi from handling them natively.

**Investigation**: Pi 0.74's `prompt()` method (what `sendUserMessage` calls) already handles extension commands internally via `_tryExecuteExtensionCommand()` — it checks if the text is a registered command and executes the handler directly, without involving the LLM. The bridge's interception prevents this native dispatch from running.

**Decision**: Change Path D to return `false` (instead of `true` with stopgap error). This lets the caller's `sendUserMessage` path run, where pi dispatches the extension command natively. No `command_feedback` events are emitted from the bridge for this path — pi handles execution silently.

**Trade-off**: Dashboard users no longer see a `command_feedback {started/completed}` acknowledgment for extension commands dispatched via the pi-native path. The command executes but the UI doesn't confirm it. Acceptable because the previous behavior was a hard error — this is strictly better. Future work can add feedback by wrapping the `sendUserMessage` call.

**Alternative considered**: Emit `command_feedback {started}` before calling `sendUserMessage` and `{completed}` after. Rejected because `sendUserMessage` is async and the command handler runs inside pi's prompt preflight — we'd emit `completed` before the handler actually finishes, misleading the user. Proper feedback requires pi's `prompt()` to return the command execution result, which is not part of the current API.

### Decision 2: `delivery` parameter defaults to `"followUp"`

The `delivery` parameter on `tryDispatchExtensionCommand` defaults to `"followUp"` when absent (via `delivery ?? "followUp"`). This matches the existing behavior and is backward-compatible with callers that don't pass delivery.

### Decision 3: `hasDispatchCommand` uses `in`-operator fallback

The pure `typeof` check may miss getter-backed or Proxy-hidden properties. Added a fallback that uses the `in` operator and a guarded `typeof` on the resolved value. This is defensive — no production scenario needs it since `dispatchCommand` never shipped. Preserved for future pi versions.

### Decision 5: `resolveTemplate` queries `pi.getCommands()` for prompt templates

**Problem**: `resolveTemplate` only checked `pi.getCommands()` for `source: "skill"` entries. Prompt templates registered with `source: "prompt"` (e.g. `/session-summary` installed by pi at `~/.pi/agent/prompts/`) were not found.

**Decision**: Add a parallel `source: "prompt"` probe in Step 3 of `resolveTemplate`, immediately after the skill lookup. Both probes share the same resolution loop over candidate-name variants, preserving original-form-first precedence. `pi.getCommands()` already returns every prompt template (global + project + package) with its absolute path, so no additional directory scanning is needed.

**Trade-off**: The `pi.getCommands()` call is already present for skills; the additional `.find()` is O(n) on the same array and adds negligible cost. `SlashCommandInfo` objects carry the path at `sourceInfo.path` — the lookup uses `c.sourceInfo?.path` directly. No fs operations added.

### Decision 4: No `started` command_feedback for Path B until `dispatchCommand` ships

Path B's `started` feedback emission was moved inside the `hasDispatchCommand` guard (alongside the `completed`/`error` emission). Previously, `started` was emitted before the path-decision block, which would leave a dangling `started` event when Path D returned `false` without a terminal event. Now each path emits its own feedback (or none, for the new Path D).

## Routing order (post-change)

```
1. !<cmd>        → bash + LLM (handleBashCommand)
2. !!<cmd>       → bash only (handleBashCommand)
3. /compact      → compact()
4. /quit, /exit  → shutdown()
5. /reload       → reload()
6. /new          → spawnNew()
7. /model <p/m>  → setModel()
8. user-defined flow name → pi.events.emit("flow:run")
9. extension command + dispatchCommand → pi.dispatchCommand(text, { streamingBehavior }) [Path B — dead code]
9b. extension command + headless RPC → dispatch_extension_command WS message [Path C]
9c. extension command + non-headless → return false, caller falls through to sendUserMessage, pi dispatches natively [Path D — changed]
10. template expansion + sendUserMessage (with deliverAs from delivery param)
11. passthrough text → sendUserMessage
```

## References

- `feat/add-steering-message` branch — introduces `delivery` on `SendPromptToExtensionMessage` and `sessionPrompt` callback.
- `fix-extension-slash-commands-in-dashboard` — establishes routing-order spec and `tryDispatchExtensionCommand`.
- `add-rpc-stdin-dispatch-with-keeper-sidecar` — Path C headless RPC dispatch mechanism.
- Pi source (`agent-session.js`): `_tryExecuteExtensionCommand()` at `prompt()` line 695-700 handles extension commands internally via registered handlers.
