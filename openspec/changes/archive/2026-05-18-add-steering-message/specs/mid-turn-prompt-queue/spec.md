## MODIFIED Requirements

### Requirement: Typed-during-streaming prompts enqueue in the bridge instead of forwarding to pi

When the bridge receives a `send_prompt` message for a streaming agent, routing depends on `msg.delivery`:

- If `delivery` is `"steer"` (or absent in a future steering-only protocol): the bridge SHALL call `pi.sendUserMessage(text, { deliverAs: "steer" })` directly. The message SHALL NOT enter the bridge-owned `PromptQueue`. Pi's internal steering queue handles the delivery timing (after the current assistant turn finishes its tool calls, before the next LLM call).
- If `delivery` is `"followUp"` or absent/undefined: the bridge SHALL push a `PendingPrompt` onto the bridge-owned `PromptQueue` (existing behavior). The bridge SHALL NOT call `pi.sendUserMessage` while the agent is streaming. The queue drains on `agent_end` with `deliverAs: "followUp"`.

Non-streaming (idle) sends SHALL call `pi.sendUserMessage(text)` without any `deliverAs` option regardless of `delivery` — both steering and followUp are meaningless when the agent is idle.

#### Scenario: Steering send during streaming bypasses the bridge queue
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "focus on X", delivery: "steer" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("focus on X", { deliverAs: "steer" })` immediately
- **AND** the bridge SHALL NOT push to the `PromptQueue`
- **AND** the bridge SHALL NOT emit a `queue_state` event for this prompt

#### Scenario: Follow-up send during streaming enters the bridge queue
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "after you're done", delivery: "followUp" }`
- **THEN** the bridge SHALL push a `PendingPrompt` onto the `PromptQueue`
- **AND** the bridge SHALL emit `queue_state { pending: [...] }` with the updated snapshot
- **AND** the bridge SHALL NOT call `pi.sendUserMessage` until `agent_end` drain

#### Scenario: Send without delivery field preserves existing behavior
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "hi" }` (no `delivery` field)
- **THEN** the bridge SHALL behave as if `delivery: "followUp"` — push to `PromptQueue`, emit `queue_state`

#### Scenario: Idle send ignores delivery field
- **WHEN** the agent is idle
- **AND** the bridge receives `send_prompt { text: "hi", delivery: "steer" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("hi")` without any `deliverAs` option
- **AND** the bridge SHALL NOT push to the `PromptQueue`

### Requirement: Protocol `send_prompt` messages carry optional delivery field

`SendPromptToExtensionMessage` and `SendPromptToBrowserMessage` SHALL include an optional `delivery?: "steer" | "followUp"` field. When absent, the receiver SHALL treat the message as `delivery: "followUp"`. The server SHALL pass `delivery` through transparently from browser → bridge without inspection or modification.

#### Scenario: delivery field survives server pass-through
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi", delivery: "steer" }`
- **THEN** the server SHALL forward `send_prompt { type: "send_prompt", sessionId: "S", text: "hi", delivery: "steer" }` to the bridge

#### Scenario: Absent delivery field is preserved as absent
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi" }` without `delivery`
- **THEN** the server SHALL forward without `delivery`
- **AND** the bridge SHALL treat as followUp

### Requirement: Client sends steer by default, followUp on modifier key

The command input SHALL send `delivery: "steer"` when the user presses Enter, and `delivery: "followUp"` when the user presses Alt+Enter (or Option+Enter on macOS). The send button click SHALL default to `delivery: "steer"`. This mirrors pi's TUI keyboard contract where Enter = steer and Alt+Enter = followUp.

The `PendingPrompt` in the client-side `SessionState` SHALL carry the `delivery` field so the optimistic chip can distinguish steering from follow-up visually.

#### Scenario: Enter sends steer
- **WHEN** the user types text and presses Enter
- **THEN** the client SHALL send `send_prompt { delivery: "steer", text, ... }`

#### Scenario: Alt+Enter sends followUp
- **WHEN** the user types text and presses Alt+Enter
- **THEN** the client SHALL send `send_prompt { delivery: "followUp", text, ... }`

#### Scenario: Send button defaults to steer
- **WHEN** the user clicks the send button
- **THEN** the client SHALL send `send_prompt { delivery: "steer", text, ... }`

#### Scenario: Optimistic chip shows delivery label
- **WHEN** `pendingPrompt.delivery === "steer"` and the chip is visible
- **THEN** the chip SHALL display a label indicating "steering" (or equivalent visual distinction)
- **WHEN** `pendingPrompt.delivery === "followUp"` and the chip is visible
- **THEN** the chip SHALL display a label indicating "follow-up"

## ADDED Requirements

### Requirement: Command input handles Alt+Enter distinct from Enter

The `CommandInput` component SHALL listen for `AltGraph + Enter` AND `Alt + Enter` key combinations, treating both as the follow-up send gesture. The existing `Enter` (unmodified) handler SHALL remain steer. Shift+Enter SHALL continue to insert a newline (existing behavior, unchanged).

#### Scenario: Alt+Enter sends followUp
- **WHEN** the user presses Alt+Enter (or Option+Enter on macOS) in the command input with text
- **THEN** the `onSend` callback SHALL be invoked with `delivery: "followUp"`

#### Scenario: Shift+Enter inserts newline (unchanged)
- **WHEN** the user presses Shift+Enter in the command input
- **THEN** a newline character SHALL be inserted and the cursor SHALL advance to the next line
- **AND** no send action SHALL fire
