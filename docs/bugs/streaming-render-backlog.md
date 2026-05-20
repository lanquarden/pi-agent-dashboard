# Bug: UI freezes during high-throughput streaming (no event batching)

**Reported:** 2026-05-19  
**Severity:** Medium — UI becomes unresponsive; session recovers after streaming ends  
**Area:** `packages/client/src/hooks/useMessageHandler.ts`, `useWebSocket.ts`

---

## Symptom

When a session produces a large streaming response (e.g. composing a long reply + a large subagent prompt simultaneously), the dashboard UI freezes for several seconds. The "generating" indicator spins but the UI appears stuck. The session resumes normally once the stream ends.

## Root cause

Every incoming WebSocket `"event"` message — including every single `message_update` token — triggers a synchronous React state update:

```typescript
// useMessageHandler.ts — fires on EVERY token
case "event":
  setSessionStates((prev) => {
    const next = new Map(prev);   // shallow-copies the whole sessions map
    next.set(msg.sessionId, reduceEvent(current, msg.event));
    return next;
  });
```

And `useWebSocket.ts` dispatches each message synchronously from `ws.onmessage` with no buffering:

```typescript
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  for (const handler of handlersRef.current) handler(msg);
};
```

There is no throttle, debounce, `requestAnimationFrame` batching, or `startTransition` anywhere in the streaming path. At high token throughput this creates a cascading render backlog:

```
token arrives → new Map(prev) → React re-render → ~10 useMemo recomputations
in SessionList → DOM reconciliation → next token already waiting → repeat
```

`SessionList.tsx` alone has ~10 `useMemo` calls that recompute on every `sessionStates` reference change. Combined with the `new Map(prev)` shallow-copy on every token, the browser JS thread stays continuously occupied and cannot process user input.

## Reproduction

1. Open a session that produces a very long streaming response (e.g. a session composing a multi-paragraph reply with a large embedded code block or subagent prompt).
2. Observe the UI: it will appear frozen/unresponsive for the duration of the stream burst.
3. After the stream ends the UI recovers immediately.

More pronounced when multiple sessions are active simultaneously (larger `sessionStates` map to copy each token).

## Proposed fix

Buffer `message_update` events and flush at ~60 fps via `requestAnimationFrame`. All other event types still apply immediately (they are low-frequency and state-critical).

```typescript
// useMessageHandler.ts

const streamingQueueRef = useRef<Map<string, DashboardEvent[]>>(new Map());
const rafRef = useRef<number | null>(null);

function flushStreamingQueue() {
  setSessionStates((prev) => {
    const next = new Map(prev);
    for (const [sessionId, events] of streamingQueueRef.current) {
      let current = next.get(sessionId) ?? createInitialState();
      for (const event of events) current = reduceEvent(current, event);
      next.set(sessionId, current);
    }
    streamingQueueRef.current.clear();
    return next;
  });
  rafRef.current = null;
}

// In the "event" case:
case "event":
  if (msg.event.type === "message_update") {
    // Buffer; flush at ~60fps
    const q = streamingQueueRef.current.get(msg.sessionId) ?? [];
    q.push(msg.event);
    streamingQueueRef.current.set(msg.sessionId, q);
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flushStreamingQueue);
    }
  } else {
    // All other events apply immediately
    setSessionStates((prev) => {
      const next = new Map(prev);
      const current = next.get(msg.sessionId) ?? createInitialState();
      next.set(msg.sessionId, reduceEvent(current, msg.event));
      return next;
    });
  }
  // seq tracking and publishSessionEvent remain unchanged
  break;
```

This reduces React re-renders during streaming from potentially hundreds per second down to ≤60/second — the maximum useful for a human-visible UI — while keeping all non-streaming events (tool calls, status changes, etc.) instant.

### Alternative / complementary approaches

- **`React.startTransition`** — wrap the `setSessionStates` call for `message_update` in `startTransition` to mark it as interruptible. Simpler change but less precise control over flush rate.
- **`useDeferredValue`** on `sessionStates` in `SessionList` — defers re-renders of the list when streaming, at the cost of showing slightly stale data. Good complement to the RAF approach.
- **Memoize `SessionCard` per-session** with `React.memo` + stable per-session selector — reduces the blast radius so only the actively-streaming card re-renders. Worth doing regardless of the batching fix.

## Files to change

| File | Change |
|------|--------|
| `packages/client/src/hooks/useMessageHandler.ts` | Add `streamingQueueRef` + `rafRef`, split `"event"` case on `message_update` vs everything else |
| `packages/client/src/components/SessionList.tsx` | (optional) `React.memo` on inner session card renderer to limit re-render blast radius |
