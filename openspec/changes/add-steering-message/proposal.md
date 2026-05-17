## Why

pi supports two message delivery modes during agent streaming:

- **steer** (`deliverAs: "steer"`): Delivered after the current assistant turn finishes executing its tool calls, before the next LLM call. Interrupts sooner.
- **followUp** (`deliverAs: "followUp"`): Delivered only when the agent finishes all work. Waits until agent is fully idle.

In pi's TUI, **Enter** sends a steering message and **Alt+Enter** sends a follow-up. The dashboard bridge currently only sends messages with `deliverAs: "followUp"` — every message from the web UI is treated as a follow-up. Users have no way to send a steering message that interrupts the agent sooner.

We need to add steering message support so dashboard users get the same two-message control that TUI users have.

## What Changes

### Protocol types

- **`SendPromptToExtensionMessage`** and **`SendPromptToBrowserMessage`** gain an optional `delivery?: "steer" | "followUp"` field. Omitted/undefined = followUp (backward-compatible).

### Bridge

- **`sessionPrompt` handler** reads `msg.delivery` from the incoming `send_prompt` message. When `delivery === "steer"`, calls `pi.sendUserMessage(text, { deliverAs: "steer" })` instead of the current `{ deliverAs: "followUp" }`.
- The steering message bypasses the bridge-owned `PromptQueue` entirely — pi handles its own internal steering queue, delivering after each turn. The bridge queue remains **follow-up only**.
- The existing `enqueueIfStreaming` / `clearQueueOnAbort` / `emitQueueState` / `drain` flow is unchanged.

### Server

- Passes `delivery` through transparently from browser → bridge. No server-side logic change needed.
- Optionally forwards pi's `queue_update` events (which carry both `steering[]` and `followUp[]` arrays) from the bridge to the dashboard so users can see pi's internal queue state. This is an **optional enhancement** — the core change works without it.

### Client

- **`CommandInput`**: `Enter` sends with `delivery: "steer"`, `Alt+Enter` sends with `delivery: "followUp"`. Mirrors pi's TUI keyboard contract.
- **`handleSend`** in `useSessionActions.ts`: accepts optional `delivery` parameter, includes it in `send_prompt` messages.
- **Send button** retains current behavior (steer by default).
- **Pending prompt chip** shows a label ("steering" or "follow-up") so the user knows which delivery mode their queued message uses.

## Capabilities

### Modified Capabilities

- `mid-turn-prompt-queue` — extended with delivery mode distinction. Follow-up remains bridge-queued with `queue_state` visibility; steering passes through to pi's internal queue.

## Impact

- Protocol: 2 lines added to two interfaces (`delivery?: "steer" | "followUp"`)
- Bridge: ~25 lines across command-handler.ts (passthrough + slash routing) and bridge.ts (sessionPrompt)
- Server: 0 lines (transparent pass-through) unless `queue_update` forwarding is implemented
- Client: ~40 lines across CommandInput, useSessionActions, ChatView, event-reducer

## Out of scope

- Forwarding pi's `queue_update` events to the dashboard (showing pi's internal steering/followUp queues as chips). This can be a follow-up change.
- `set_steering_mode` / `set_follow_up_mode` controls (pi's queue delivery modes: "all" vs "one-at-a-time"). These are pi-internal settings, not dashboard concerns.
- The `steer()` and `followUp()` SDK methods on `AgentSession` — these are pi-internal; the bridge uses `sendUserMessage` with `deliverAs`.

## Dependencies

- pi ≥ 0.70 (the version that introduced `deliverAs: "steer"` on `sendUserMessage`). Current minimum is already satisfied.
