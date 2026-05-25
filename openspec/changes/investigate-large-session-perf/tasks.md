# Tasks

## 1. Profile Session Load

- [ ] Load `019e60b5` in the browser with React DevTools Profiler
- [ ] Measure: time to first paint, event list render, total JS heap
- [ ] Capture a performance trace (Chrome Performance tab)
- [ ] Measure `/api/sessions/:id/events` response size and server-side timing

## 2. Profile Server Memory

- [ ] Check `memory-event-store` behaviour: how many events actually held in LRU for this session
- [ ] Measure per-event memory cost (message vs custom)
- [ ] Check if event payload truncation is effective for large message content

## 3. Identify Bottlenecks

- [ ] Rank findings by impact (render time, memory, latency)
- [ ] Document root causes in `design.md`

## 4. Propose Fixes

- [ ] For each bottleneck, propose a fix with effort estimate (S/M/L)
- [ ] Prioritize by impact/effort ratio

## 5. Apply Quick Wins

- [ ] Implement any fixes estimated ≤ M that show clear benefit
