## 1. Protocol types

- [x] 1.1 Add optional `delivery?: "steer" | "followUp"` to `SendPromptToExtensionMessage` in `packages/shared/src/protocol.ts`.
- [x] 1.2 Add optional `delivery?: "steer" | "followUp"` to `SendPromptToBrowserMessage` in `packages/shared/src/browser-protocol.ts`.

## 2. Bridge — steering delivery

- [x] 2.1 Add optional `delivery` parameter to `sessionPrompt` callback type and `CommandHandlerOptions` interface.
- [x] 2.2 In `command-handler.ts` `case "send_prompt"`: pass `msg.delivery` to `sessionPrompt` for slash commands.
- [x] 2.3 In `command-handler.ts` passthrough branch: when `msg.delivery === "steer"`, skip `enqueueIfStreaming` and call `sendUserMessageWithImages` with `deliverAs: "steer"` directly. When `"followUp"` or undefined, keep existing behavior.
- [x] 2.4 In `bridge.ts` `sessionPrompt` handler: when `delivery === "steer"`, call `pi.sendUserMessage(text, { deliverAs: "steer" })`. When `"followUp"` or undefined, keep existing `{ deliverAs: "followUp" }` behavior.
- [x] 2.5 No changes to `PromptQueue` — steering messages bypass the bridge queue and go directly to pi's internal steering queue.

## 3. Client — delivery mode selection

- [x] 3.1 `useSessionActions` / `handleSend`: accept optional `delivery` parameter, include in `send_prompt` payload.
- [x] 3.2 `event-reducer`: add `delivery?: "steer" | "followUp"` to `PendingPrompt` interface.
- [x] 3.3 `CommandInput`: Enter key sends `delivery: "steer"`, Alt+Enter sends `delivery: "followUp"`. Send button defaults to steer.
- [x] 3.4 `ChatView` pending-prompt chip: show "(steering)" or "(follow-up)" label based on `pendingPrompt.delivery`.
- [x] 3.5 `App.tsx`: pass `delivery` through from `queuedTexts` computation (wrappedHandleSend passes delivery through).

## 4. Bridge tests

- [x] 4.1 `command-handler.test.ts`: add test — `delivery: "steer"` on passthrough message calls `sendUserMessageWithImages` with `deliverAs: "steer"`, skips bridge queue.
- [x] 4.2 `command-handler.test.ts`: add test — `delivery: "followUp"` (or undefined) preserves existing `deliverAs: "followUp"` behavior.
- [x] 4.3 `command-handler.test.ts`: add test — `delivery: "steer"` on slash command passes through to `sessionPrompt` with delivery param.
- [ ] 4.4 `bridge-slash-command-routing.test.ts`: update existing tests that call `sendUserMessage` — verify `deliverAs: "steer"` when delivery param is `"steer"`.

## 5. Client tests

- [ ] 5.1 `useSessionActions` tests: verify `send_prompt` payload includes `delivery` field when provided. (Deferred — no existing test file for this hook; behavior is validated indirectly through CommandInput and bridge tests.)
- [x] 5.2 `event-reducer.test.ts`: verify `pendingPrompt.delivery` is stored and cleared correctly on agent_start/agent_end/abort.
- [x] 5.3 `CommandInput` tests: verify Enter emits `delivery: "steer"`, Alt+Enter emits `delivery: "followUp"`.
