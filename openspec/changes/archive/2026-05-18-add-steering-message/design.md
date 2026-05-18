## Context

pi supports two `sendUserMessage` delivery modes when the agent is streaming:

| Mode | `deliverAs` | Delivery timing |
|------|-------------|-----------------|
| **steer** | `"steer"` | After current assistant turn finishes tool calls, before next LLM call |
| **followUp** | `"followUp"` | After agent finishes all work (fully idle) |

In pi's TUI, **Enter** sends a steering message; **Alt+Enter** sends a follow-up. The dashboard bridge today only uses `deliverAs: "followUp"`. This change adds steering support.

## Goals / Non-Goals

**Goals**

- Dashboard users can send steering messages (delivered sooner, after current turn) in addition to follow-up messages (delivered after agent finishes).
- Keyboard shortcut mirrors pi TUI: Enter = steer, Alt+Enter = followUp.
- Backward compatible: messages without a `delivery` field behave as followUp (existing behavior).

**Non-Goals**

- Showing pi's internal steering queue in the dashboard UI. Pi emits a `queue_update` event with both `steering[]` and `followUp[]` arrays, but forwarding that to the dashboard requires a new event path, server-side caching, and UI rendering — deferred to a follow-up change.
- `set_steering_mode` / `set_follow_up_mode` controls. These are pi-internal settings governing how the two queues drain ("all" vs "one-at-a-time"). Not a dashboard concern.
- The `AgentSession.steer()` and `AgentSession.followUp()` SDK methods. The bridge uses `sendUserMessage` with `deliverAs`, which is the extension API surface.

## Decision: steering bypasses the bridge-owned PromptQueue

**Option A**: Extend the bridge's `PromptQueue` to hold TWO lists — `steering[]` and `followUp[]` — and drain steering entries on `turn_end` instead of `agent_end`.

**Option B**: Let pi handle steering queueing internally. The bridge calls `pi.sendUserMessage(text, { deliverAs: "steer" })` and pi manages its own steering queue (delivery after current turn). The bridge queue remains follow-up only.

**Chosen: B.** Reasoning:

1. Pi already has an internal steering queue with configurable delivery modes (`set_steering_mode`). Duplicating that logic in the bridge would be fragile and drift-prone.
2. Pi's `queue_update` event exposes the internal steering queue state. If we later want dashboard visibility, we forward that event — we don't need a parallel queue.
3. Simpler bridge code: steering is a one-line `deliverAs` change; followUp keeps the existing bridge queue path unchanged.
4. The bridge queue exists because followUp needs to wait until `agent_end` (pi doesn't have a "hold until idle" queue — `followUp` is delivered immediately when pi is idle, but the bridge needs to buffer across WebSocket latency). Steering doesn't have this problem — pi's internal steering queue handles turn-delimiting natively.

## Decision: `delivery` field is optional, absent = followUp

**Option A**: Make `delivery` required (every `send_prompt` must specify steer or followUp).

**Option B**: Make `delivery` optional, default to followUp when absent.

**Chosen: B.** Backward compatibility. Existing clients (older dashboard versions, custom WebSocket consumers) send `send_prompt` without `delivery`. Requiring the field would break them unnecessarily. The bridge treats absent as `followUp`, which is the current behavior — zero semantic change for existing senders.

## Decision: Enter = steer by default

**Option A**: Keep Enter as followUp (current behavior), add a separate UI control (dropdown/toggle) to switch to steer.

**Option B**: Enter = steer, Alt+Enter = followUp (mirrors pi TUI).

**Chosen: B.** Reasoning:

1. Consistency: users who know pi's TUI shortcuts expect the same in the dashboard.
2. Steer is the more common intent when typing during streaming — you want the agent to notice the new instruction ASAP.
3. FollowUp (wait until done) is the less common intent and deserves the modifier key.
4. The send button click also defaults to steer for the same reason.

## Decision: `CommandHandlerOptions.sessionPrompt` signature change

Current signature: `sessionPrompt?: (text: string) => void | Promise<void>`

Needs to accept delivery so slash commands routed through `sessionPrompt` (bridge.ts) can honor the delivery mode.

**Option A**: Add a second positional param: `sessionPrompt?: (text: string, delivery?: "steer" | "followUp") => void | Promise<void>`.

**Option B**: Pack into an options object: `sessionPrompt?: (opts: { text: string; delivery?: "steer" | "followUp" }) => void | Promise<void>`.

**Chosen: A.** Matches the existing style of `enqueueIfStreaming?: (text: string, images?: ImageContent[]) => boolean` which uses positional params. Keeps the churn minimal — only one new optional param at the end.

## The Two Code Paths Affected

Messages reach the bridge from the dashboard via two paths in `command-handler.ts`:

1. **Passthrough** (plain text, multiline slashes): goes through `enqueueIfStreaming` → `sendUserMessageWithImages`. For steer: skip `enqueueIfStreaming`, call `sendUserMessageWithImages(pi, text, images, "steer")`.

2. **Slash commands** (`parsed.type === "slash"`): routed to `options.sessionPrompt(parsed.text)`. For steer: pass `msg.delivery` through to `sessionPrompt`, which propagates it to `pi.sendUserMessage(text, { deliverAs: "steer" })`.

The `sendUserMessageWithImages` helper in `command-handler.ts` currently hardcodes `deliverAs: "followUp"`. It gains an optional `deliverAs?: "steer" | "followUp"` parameter; when provided, it passes that value; when absent, it defaults to `"followUp"` (backward compatible).

## Risks

- **Pi version dependency**: `deliverAs: "steer"` on `sendUserMessage` was introduced in pi 0.70. The dashboard already requires pi ≥ 0.71 (per `adopt-pi-071-072-073-features`), so this is safe.
- **`sendUserMessage` typing**: The bridge currently calls `pi.sendUserMessage` via `(pi.sendUserMessage as any)(...)` because the extension API types may not include the `deliverAs` option. This pattern already exists for `deliverAs: "followUp"` — adding `"steer"` is the same risk profile.
- **Slash commands with steer**: Extension-command dispatch (`tryDispatchExtensionCommand`) uses `streamingBehavior: "followUp"` on `pi.dispatchCommand`. Steering slash commands that fall through to `sessionPrompt` will use `deliverAs: "steer"` instead. Extension commands that are dispatched (not fallen through) retain their existing behavior — they are not configurable from the dashboard for delivery mode, which is correct since extension commands manage their own delivery.
