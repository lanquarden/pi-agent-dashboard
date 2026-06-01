## ADDED Requirements

### Requirement: Generic tool-row enrichment via event_forward

The event reducer SHALL treat any `event_forward` message whose `data` contains a `toolCallId` string as a plugin enrichment targeting that tool row. The payload SHALL be stored at `args._pluginData[eventType]` so multiple plugins can annotate the same tool row independently without collision.

#### Scenario: event_forward patches existing tool row

- **WHEN** an `event_forward` with `eventType: "pi-dev-worktrees:bash-dispatch"` and `data: { toolCallId: "tc1", routing: "container" }` arrives, and a tool row with `toolCallId: "tc1"` already exists
- **THEN** the row's `args._pluginData["pi-dev-worktrees:bash-dispatch"]` SHALL be `{ routing: "container" }`.

#### Scenario: event_forward buffers when row not yet created

- **WHEN** an `event_forward` with `toolCallId: "tc1"` arrives before `tool_execution_start` creates the row
- **THEN** the enrichment SHALL be buffered in `pendingEnrichments` and SHALL be applied to `args._pluginData` when the row is created.

#### Scenario: Multiple plugins annotate same row

- **WHEN** plugin A emits `event_forward { eventType: "a:data", toolCallId: "tc1", ... }` and plugin B emits `event_forward { eventType: "b:data", toolCallId: "tc1", ... }`
- **THEN** the row's `args._pluginData` SHALL contain both `"a:data"` and `"b:data"` keys with their respective payloads.

#### Scenario: Non-plugin event_forward unaffected

- **WHEN** an `event_forward` without a `toolCallId` in its data arrives
- **THEN** the reducer SHALL NOT treat it as a tool-row enrichment. It SHALL fall through to the raw event rendering path.

### Requirement: pendingEnrichments buffer with size cap

`SessionState` SHALL include a `pendingEnrichments: Map<string, Map<string, unknown>>` field. `createInitialState()` SHALL initialize it to an empty Map. The buffer SHALL be capped at 20 entries to prevent unbounded growth from buggy plugins emitting events with `toolCallId` values that never match a real tool call. When the cap is exceeded, the oldest entry SHALL be evicted.

#### Scenario: Buffer cap evicts oldest

- **WHEN** 21 different `toolCallId` values are buffered before any matching tool row is created
- **THEN** the first (oldest) entry SHALL be evicted and the 21st SHALL be stored.

#### Scenario: Buffer cleared on row creation

- **WHEN** a `tool_execution_start` event creates a row with `toolCallId: "tc1"` and `pendingEnrichments` has an entry for `"tc1"`
- **THEN** the enrichment SHALL be applied to the row's `args._pluginData`, and `"tc1"` SHALL be removed from `pendingEnrichments`.
