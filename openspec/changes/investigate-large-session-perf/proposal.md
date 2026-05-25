# Investigate Performance Degradation on Large Context Sessions

## Summary

Dashboard performance degrades on sessions with large context (many events). Investigate root causes and apply targeted fixes.

## Example Session

- **ID**: `019e60b5-ee90-7996-9bc3-5f13058d8887`
- **Events**: 721 (490 message, 227 custom)
- **JSONL size**: 1.7 MB
- **Duration**: ~2h 13m
- **URL**: <http://localhost:8000/session/019e60b5-ee90-7996-9bc3-5f13058d8887>

## Symptoms

- UI sluggishness when viewing the session (`/session/:id`)
- Server memory pressure: 329 MB RSS / 160 MB heap with 45 known sessions (only 1 active)

## Potential Areas

1. **memory-event-store.ts** — LRU cap of 100 × 5000 events. Large sessions contribute disproportionately to memory. Event payload truncation may not be aggressive enough for `message`/`custom` events with large content.
2. **Client-side rendering** — 721 events with rich Markdown content may overwhelm React rendering (no virtual scrolling, no chunking).
3. **Event replay on subscribe** — batched replay on session view may block the main thread or saturate the WebSocket.
4. **MarkdownContent** — large message content (code blocks, long tool outputs) parsed on render.

## Acceptance Criteria

- [ ] Profile the example session: measure render time, memory footprint, event replay latency
- [ ] Identify the top 1–2 bottlenecks
- [ ] Propose fixes with effort estimates
