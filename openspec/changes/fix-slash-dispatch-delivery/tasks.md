## 1. Protocol: add `delivery` field

- [x] 1.1 Add optional `delivery?: "steer" | "followUp"` field to `SendPromptToExtensionMessage` in `packages/shared/src/protocol.ts`.
  - File: `packages/shared/src/protocol.ts`
  - JSDoc: see change: add-steering-message.

## 2. `slash-dispatch.ts`: delivery param + Path D removal

- [x] 2.1 Add optional `delivery?: "steer" | "followUp"` parameter to `tryDispatchExtensionCommand`.
- [x] 2.2 Use `delivery ?? "followUp"` for `streamingBehavior` on the Path B `dispatchCommand` call.
- [x] 2.3 Move `emitFeedback(started)` inside the `hasDispatchCommand` guard (Path B only) so Path D return-`false` doesn't leave a dangling `started` event.
- [x] 2.4 Move `emitFeedback(started)` inside Path C guard (was before the path-decision block).
- [x] 2.5 Remove Path D stopgap error — return `false` instead so caller falls through to `sendUserMessage`.
- [x] 2.6 Add `console.warn` diagnostic when `dispatchCommand` is unavailable (Path D) noting that command falls through to `sendUserMessage`.
- [x] 2.7 Remove unused `PI_071_REQUIRED` constant.
  - File: `packages/extension/src/slash-dispatch.ts`

## 3. `bridge.ts`: delivery plumbing

- [x] 3.1 Add `delivery` parameter to the `sessionPrompt` callback closure.
- [x] 3.2 Pass `delivery` as the 6th argument to `tryDispatchExtensionCommand`.
- [x] 3.3 Use `delivery ?? "followUp"` for `deliverAs` on the `sendUserMessage` fallback.
  - File: `packages/extension/src/bridge.ts`

## 4. `command-handler.ts`: delivery type + non-bridge call site

- [x] 4.1 Update `sessionPrompt` callback type to `(text: string, delivery?: "steer" | "followUp") => void | Promise<void>`.
- [x] 4.2 Pass `msg.delivery` to `sessionPrompt` call in slash else-arm.
- [x] 4.3 Pass `msg.delivery` as 6th argument to `tryDispatchExtensionCommand` in the non-bridge else-arm.
  - File: `packages/extension/src/command-handler.ts`

## 5. `bridge-context.ts`: `hasDispatchCommand` improvement

- [x] 5.1 Add `in`-operator fallback in `hasDispatchCommand` for getter-backed / Proxy-hidden properties.
- [x] 5.2 Add null-guard at top of function (`pi == null → false`).
- [x] 5.3 Update JSDoc with change reference.
  - File: `packages/extension/src/bridge-context.ts`

## 6. Tests

- [x] 6.1 `bridge-slash-command-routing.test.ts` — direct-driver: Path B with `delivery: "steer"`, `"followUp"`, and absent.
- [x] 6.2 `bridge-slash-command-routing.test.ts` — regression contract: extension cmd with `delivery: "steer"` → `dispatchCommand` called with `{ streamingBehavior: "steer" }`.
- [x] 6.3 `bridge-slash-command-routing.test.ts` — regression contract: extension cmd without `dispatchCommand` → `sendUserMessage` called, no `command_feedback`.
- [x] 6.4 `bridge-slash-command-routing.test.ts` — direct-driver: Path D returns `false`, no `command_feedback`, no `connection.send`.
- [x] 6.5 `bridge-slash-command-routing.test.ts` — direct-driver: mutual exclusion updated (fallthrough instead of D).
- [x] 6.6 `command-handler.test.ts` — delivery propagation: `send_prompt` with `delivery: "steer"` → `sessionPrompt` receives `"steer"`.
- [x] 6.7 `command-handler.test.ts` — update `sessionPrompt` assertion to include second `undefined` arg.
  - Files: `packages/extension/src/__tests__/bridge-slash-command-routing.test.ts`, `packages/extension/src/__tests__/command-handler.test.ts`

## 7. `prompt-expander.ts`: global prompt template resolution

- [x] 7.1 Add parallel `source: "prompt"` lookup in `resolveTemplate` Step 3.
  - After the existing `commands.find(c => c.source === "skill")`, add a second `.find()` for `c.source === "prompt" && c.path`.
  - Return `{ filePath, source: "prompt", resolvedName: cand }` on hit.
  - `pi.getCommands()` already returns every prompt template (global + project + package) with its path — no additional directory scanning needed.
  - File: `packages/extension/src/prompt-expander.ts`

## Verification

- [x] 7.2 Run `npm test` — all 714 tests pass (no regressions).
- [x] 7.3 Manual verification — `/session-summary` invoked from dashboard successfully expands the template from `~/.pi/agent/prompts/session-summary.md` and the agent executes the workflow.
