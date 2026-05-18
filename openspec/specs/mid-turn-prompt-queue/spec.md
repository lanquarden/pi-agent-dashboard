# Mid-turn Prompt Queue

## Purpose

Surface a per-session, bridge-held FIFO of prompts typed while the agent is mid-turn. Users can compose follow-ups during streaming; the bridge buffers them, the server caches the snapshot, and the client renders chips above the chat input. On `agent_end` the bridge drains the queue back into pi, in FIFO order, preserving image attachments.

## Requirements

### Requirement: Bridge holds a per-session mid-turn prompt queue

The bridge extension SHALL maintain a per-session, in-memory FIFO of `PendingPrompt` records where `PendingPrompt = { id: string; text: string; images?: ImageContent[] }`. The `id` is a bridge-minted opaque string unique within the session lifetime; the server and client SHALL treat it as a black-box key. The queue SHALL start empty on session register and SHALL reset to empty on session re-register, switch, fork, or shutdown.

#### Scenario: Initial queue is empty
- **WHEN** a bridge registers a session for the first time
- **THEN** the bridge's queue for that session SHALL be empty

#### Scenario: Queue resets on re-register
- **WHEN** a bridge re-registers for a session whose prior bridge instance had a non-empty queue
- **THEN** the new instance SHALL start with an empty queue and SHALL NOT inherit the prior bridge's entries

#### Scenario: PendingPrompt id uniqueness
- **WHEN** the bridge enqueues two prompts within the same session lifetime
- **THEN** their `id` values SHALL be distinct

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

#### Scenario: Slash commands are not enqueued
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "/compact" }`
- **THEN** the bridge SHALL route the command through its existing slash dispatcher
- **AND** the bridge SHALL NOT push to the queue

#### Scenario: Bash and meta commands are not enqueued
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "!ls" }` (or any `!`, `!!`, `/bash`, `/compact`, `/reload`, `/new`, `/model`, `/skill:*`, prompt template, etc.)
- **THEN** the bridge SHALL route the command through its existing pre-existing branches
- **AND** the bridge SHALL NOT push to the queue

### Requirement: Protocol `send_prompt` messages carry optional delivery field

`SendPromptToExtensionMessage` and `SendPromptToBrowserMessage` SHALL include an optional `delivery?: "steer" | "followUp"` field. When absent, the receiver SHALL treat the message as `delivery: "followUp"`. The server SHALL pass `delivery` through transparently from browser → bridge without inspection or modification.

#### Scenario: delivery field survives server pass-through
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi", delivery: "steer" }`
- **THEN** the server SHALL forward `send_prompt { type: "send_prompt", sessionId: "S", text: "hi", delivery: "steer" }` to the bridge

#### Scenario: Absent delivery field is preserved as absent
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi" }` without `delivery`
- **THEN** the server SHALL forward without `delivery`
- **AND** the bridge SHALL treat as followUp

### Requirement: Bridge emits `queue_state` events on every queue mutation

The bridge SHALL emit `event_forward { eventType: "queue_state", data: { pending: PendingPrompt[] } }` on every push, drain step, and clear. The `pending` array SHALL be the complete current snapshot of the queue, in insertion order. The bridge SHALL NOT emit deltas.

#### Scenario: First enqueue produces snapshot of length 1
- **WHEN** the bridge pushes the first entry for a session whose queue was empty
- **THEN** the bridge SHALL emit `queue_state { pending: [<the new entry>] }`

#### Scenario: Each drain step emits an updated snapshot
- **WHEN** the bridge drains an entry (calls `pi.sendUserMessage` and removes the entry from the queue)
- **THEN** the bridge SHALL emit `queue_state { pending: <remaining entries> }`

#### Scenario: Clear produces empty snapshot
- **WHEN** the bridge handles `clear_queue` for a session whose queue had entries
- **THEN** the bridge SHALL emit `queue_state { pending: [] }`

#### Scenario: Snapshots are session-scoped
- **WHEN** the bridge has non-empty queues for sessions A and B
- **AND** the bridge clears the queue for session A
- **THEN** the bridge SHALL emit `queue_state { pending: [] }` for session A
- **AND** the bridge SHALL NOT emit any update for session B

### Requirement: Bridge drains the queue on `agent_end`

When the bridge observes `agent_end` for a session whose queue is non-empty, AND after the bridge's internal `isAgentStreaming` flag has been cleared, the bridge SHALL drain the queue. The drain SHALL be scheduled as a macrotask (`setTimeout`) with a grace window of at least 50 ms, NOT as a microtask, so that any in-flight `clear_queue` or `remove_queue_entry` WebSocket message reaches the bridge before the first drain step commits. Before the first drain step runs, the bridge SHALL re-check that the queue is non-empty and SHALL skip the drain entirely if a clear racing the grace window has emptied it. For each remaining entry in insertion order, the bridge SHALL call `pi.sendUserMessage(entry.text, entry.images)` without a `deliverAs` option, remove the entry from the queue, and emit an updated `queue_state` snapshot. Between drain steps the bridge SHALL yield to the I/O loop so a mid-drain `clear_queue` or `remove_queue_entry` can take effect before the next entry is committed. The drain SHALL stop early if the queue becomes empty (e.g. because of a `clear_queue` during the drain).

#### Scenario: Drain runs entries in FIFO order
- **WHEN** the queue is `[A, B, C]` at the moment of `agent_end`
- **THEN** the bridge SHALL call `pi.sendUserMessage` first for `A`, then `B`, then `C`

#### Scenario: Drain emits snapshots between entries
- **WHEN** the queue is `[A, B]` at the moment of `agent_end` and the drain begins
- **THEN** the bridge SHALL emit `queue_state { pending: [B] }` after sending A
- **AND** the bridge SHALL emit `queue_state { pending: [] }` after sending B

#### Scenario: Drain is cancellable by clear_queue
- **WHEN** the queue is `[A, B, C]` and the drain has already sent A
- **AND** the bridge receives `clear_queue` for the session
- **THEN** the bridge SHALL stop the drain
- **AND** the bridge SHALL emit `queue_state { pending: [] }`
- **AND** `B` and `C` SHALL NOT be sent

#### Scenario: Clear racing the agent_end grace window prevents any drain step
- **WHEN** the queue is `[A, B, C]` at the moment of `agent_end`
- **AND** the bridge receives `clear_queue` for the session within the 50 ms grace window before the first drain step runs
- **THEN** the bridge SHALL emit `queue_state { pending: [] }`
- **AND** the bridge SHALL NOT call `pi.sendUserMessage` for any of `A`, `B`, or `C`

#### Scenario: Drain on empty queue is a no-op
- **WHEN** the bridge observes `agent_end` and the session's queue is empty
- **THEN** the bridge SHALL NOT call `pi.sendUserMessage`
- **AND** the bridge SHALL NOT emit a `queue_state` event

### Requirement: `clear_queue` browser-to-server message

The protocol SHALL define a browser-to-server message `clear_queue { type: "clear_queue", sessionId: string }`. On receipt, the server SHALL forward an equivalent `clear_queue { type: "clear_queue", sessionId }` message to the session's bridge via `piGateway.sendToSession`. The bridge SHALL empty its in-memory queue for that session and emit a `queue_state` snapshot with `pending: []`. The operation SHALL be idempotent: clearing an already-empty queue still emits a (possibly redundant) `queue_state` snapshot.

#### Scenario: Clear from browser empties the queue end-to-end
- **WHEN** a browser sends `clear_queue { sessionId: "S" }` to the server while `Session.queue.pending` for S is `[A, B]`
- **THEN** the server SHALL forward the message to S's bridge
- **AND** the bridge SHALL empty its in-memory queue for S
- **AND** the bridge SHALL emit `queue_state { pending: [] }`
- **AND** within one event round-trip every subscribed browser SHALL observe `Session.queue.pending` for S as `[]`

#### Scenario: Clear on empty queue is a no-op modulo snapshot
- **WHEN** a browser sends `clear_queue` while the bridge's queue for the session is already empty
- **THEN** the server SHALL forward the message
- **AND** the bridge SHALL emit `queue_state { pending: [] }`
- **AND** no error SHALL be raised; observable state SHALL remain unchanged

#### Scenario: Clear for unknown session is dropped
- **WHEN** a browser sends `clear_queue { sessionId: "missing" }` for a session the server does not know
- **THEN** the server SHALL drop the message and SHALL NOT forward anything to a bridge

### Requirement: `remove_queue_entry` browser-to-server message

The protocol SHALL define a browser-to-server message `remove_queue_entry { type: "remove_queue_entry", sessionId: string, id: string }`. On receipt, the server SHALL forward `remove_queue_entry { sessionId, id }` to the bridge via `piGateway.sendToSession`. The bridge SHALL drop the entry whose `id` matches and emit a fresh `queue_state` snapshot reflecting the remaining queue. The operation SHALL be idempotent: an unknown `id` SHALL NOT raise an error, and the bridge SHALL still emit a (possibly redundant) `queue_state` snapshot. Order of remaining entries SHALL be preserved.

#### Scenario: Remove drops the matching entry and emits a fresh snapshot
- **WHEN** the bridge's queue is `[A, B, C]` and a browser sends `remove_queue_entry { id: B.id }`
- **THEN** the bridge SHALL emit `queue_state { pending: [A, C] }`
- **AND** `B` SHALL NOT be delivered to pi on the next drain

#### Scenario: Remove with unknown id is a no-op modulo snapshot
- **WHEN** the bridge's queue is `[A]` and a browser sends `remove_queue_entry { id: "bq_missing" }`
- **THEN** the bridge SHALL emit `queue_state { pending: [A] }`
- **AND** no error SHALL be raised

#### Scenario: Remove for unknown session is dropped
- **WHEN** a browser sends `remove_queue_entry { sessionId: "missing", id: "x" }` for a session the server does not know
- **THEN** the server SHALL drop the message and SHALL NOT forward anything to a bridge

### Requirement: Server caches per-session queue state from `queue_state` events

The dashboard server SHALL maintain a `Session.queue` field of shape `{ pending: PendingPrompt[] }`. The default value for any new or re-registered session SHALL be `{ pending: [] }`. On receiving a `queue_state` event from a bridge, the server SHALL replace the session's `queue.pending` array wholesale with the event's `data.pending` payload (no merging) and SHALL broadcast a `session_updated` (or equivalent UI cache update) carrying the new `queue` value to every subscribed browser.

#### Scenario: Wholesale replace on update
- **WHEN** the server receives `queue_state { data: { pending: [{id:"q1",text:"a"},{id:"q2",text:"b"}] } }` for a session
- **AND** the prior `Session.queue.pending` was `[{id:"q0",text:"x"}]`
- **THEN** the server's `Session.queue.pending` SHALL become `[{id:"q1",text:"a"},{id:"q2",text:"b"}]` (no merge with prior state)

#### Scenario: Broadcast to subscribed browsers
- **WHEN** the server updates a session's `queue` from a `queue_state` event
- **THEN** every browser subscribed to that session SHALL receive a session-updated broadcast carrying the new `queue` value

#### Scenario: Replay on subscribe
- **WHEN** a browser subscribes to a session whose `Session.queue.pending` is non-empty
- **THEN** the initial subscription replay SHALL include the current `queue` value

#### Scenario: Queue reset on session re-registration
- **WHEN** a bridge re-registers for a session whose `Session.queue.pending` was non-empty
- **THEN** the server SHALL reset `Session.queue.pending` to `[]` and wait for a fresh `queue_state` event from the bridge before showing any queue contents

### Requirement: Queue panel renders above the chat input

When `Session.queue.pending.length > 0` for the currently selected session, the chat view SHALL render a queue panel between the message list and the chat input. The panel SHALL list each queued message as a chip displaying the message text truncated to one line with overflow ellipsis. The panel SHALL include a "Clear all" affordance that, when clicked, sends a `clear_queue { sessionId }` message for the active session.

#### Scenario: Empty queue hides the panel
- **WHEN** `Session.queue.pending` is `[]`
- **THEN** the queue panel SHALL NOT be rendered

#### Scenario: Non-empty queue renders chips in insertion order
- **WHEN** `Session.queue.pending` is `[{id:"q1",text:"A"},{id:"q2",text:"B"},{id:"q3",text:"C"}]`
- **THEN** the queue panel SHALL render three chips in order: `A`, `B`, `C`

#### Scenario: Long message text truncates
- **WHEN** a queue chip's message text exceeds the chip's render width
- **THEN** the chip SHALL display the text with an ellipsis and SHALL NOT wrap to multiple lines

#### Scenario: Clear all sends clear_queue
- **WHEN** the user clicks the queue panel's "Clear all" button while subscribed to session S
- **THEN** the client SHALL send `clear_queue { type: "clear_queue", sessionId: "S" }` to the server

#### Scenario: Per-chip remove button sends remove_queue_entry
- **WHEN** the user clicks the X button on a chip whose entry id is `E` while subscribed to session S
- **THEN** the client SHALL send `remove_queue_entry { type: "remove_queue_entry", sessionId: "S", id: "E" }` to the server

#### Scenario: Each chip exposes a remove affordance
- **WHEN** the queue panel renders any chip
- **THEN** that chip SHALL include an X / remove button that, on click, invokes the per-entry remove flow

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

### Requirement: Command input handles Alt+Enter distinct from Enter

The `CommandInput` component SHALL listen for `AltGraph + Enter` AND `Alt + Enter` key combinations, treating both as the follow-up send gesture. The existing `Enter` (unmodified) handler SHALL remain steer. Shift+Enter SHALL continue to insert a newline (existing behavior, unchanged).

#### Scenario: Alt+Enter sends followUp
- **WHEN** the user presses Alt+Enter (or Option+Enter on macOS) in the command input with text
- **THEN** the `onSend` callback SHALL be invoked with `delivery: "followUp"`

#### Scenario: Shift+Enter inserts newline (unchanged)
- **WHEN** the user presses Shift+Enter in the command input
- **THEN** a newline character SHALL be inserted and the cursor SHALL advance to the next line
- **AND** no send action SHALL fire

### Requirement: Image attachments are not displayed on chips in v1

Pi 0.74 receives image-bearing prompts via `pi.sendUserMessage(content, ...)` where `content` is an array of `TextContent | ImageContent`. The bridge holds the original `images` array on the `PendingPrompt`, but in v1 the queue chips SHALL render text only and SHALL NOT display image previews. When the user sends an image-bearing prompt that enters the bridge queue, the optimistic-prompt card SHALL still render with image thumbnails (per the existing `optimistic-prompt` capability) until that prompt is observed in the queue, at which point the card SHALL be replaced by a text-only chip and the image previews SHALL no longer be visible.

#### Scenario: Image-bearing send shows optimistic card with images, then text-only chip
- **WHEN** the user sends `{ text: "describe", images: [PNG] }` while the agent is streaming
- **THEN** initially an optimistic card SHALL render with the text and the PNG thumbnail
- **WHEN** the next `queue_state` event reports `pending: [{id:..., text:"describe", images:[PNG]}]`
- **THEN** the optimistic card SHALL be replaced by a text-only chip displaying "describe" with no image thumbnail

#### Scenario: Drain preserves image attachments
- **WHEN** the bridge drains a `PendingPrompt` that carries `images`
- **THEN** the bridge SHALL call `pi.sendUserMessage` with the content array including the original images
- **AND** the resulting agent turn SHALL receive the images via pi's standard image handling

### Requirement: Session card shows a count-only queue indicator

When a session's `queue.pending.length > 0`, the session card in the session list SHALL display a small queue indicator showing the total count. The indicator SHALL NOT show queue contents — it is an at-a-glance signal only. When the count is zero, no indicator SHALL be rendered.

#### Scenario: Indicator appears when queue non-empty
- **WHEN** `Session.queue.pending` has 3 entries for a session
- **THEN** that session's card SHALL display a queue indicator with the count `3`

#### Scenario: Indicator hidden when queue empty
- **WHEN** `Session.queue.pending` is `[]` for a session
- **THEN** no queue indicator SHALL be rendered on that session's card

### Requirement: Queue render cap keeps the LATEST entries visible

The queue panel SHALL render at most 5 chips inline. If `pending.length > 5`, the panel SHALL render an overflow affordance reading "+N earlier" (where N is the hidden count) on the LEFT, followed by the LATEST 5 chips on the right (in insertion order within the visible window). The just-typed entry is therefore always visible as the rightmost chip; older entries collapse into the overflow indicator. The "+N earlier" affordance is read-only in v1; clicking it has no required action and MAY be made expandable later without protocol change.

#### Scenario: Queue of 4 renders all 4 chips
- **WHEN** `pending.length === 4`
- **THEN** the panel SHALL render 4 chips and SHALL NOT render an overflow affordance

#### Scenario: Queue of 8 renders "+3 earlier" on the LEFT plus the latest 5 chips
- **WHEN** `pending.length === 8` with entries `[A, B, C, D, E, F, G, H]` (oldest first)
- **THEN** the panel SHALL render a single "+3 earlier" affordance followed by chips for `D, E, F, G, H` in that order
- **AND** the rightmost chip SHALL be `H` (the latest entry)
