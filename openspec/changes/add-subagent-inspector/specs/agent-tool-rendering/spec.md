## ADDED Requirements

### Requirement: Subagent card SHALL be inline-expandable

The `Agent` tool card rendered by `AgentToolRenderer` SHALL display a collapse/expand toggle in its header. When expanded, the card body SHALL render the `<SubagentDetailView>` component for that subagent's `agentId`.

#### Scenario: Default state is collapsed

- **WHEN** the dashboard receives a new `Agent` tool call
- **THEN** the rendered card body SHALL show only the collapsed header, description, activity line, and stats — no inline detail view

#### Scenario: Expanding shows the detail view

- **GIVEN** a collapsed `Agent` card with `details.agentId` resolvable
- **WHEN** the user clicks the expand toggle
- **THEN** the card body SHALL render `<SubagentDetailView mode="inline" agentId={…} />` with `max-h-[60vh]` internal scroll
- **AND** the toggle icon SHALL flip to indicate the expanded state

#### Scenario: Toggle persists across re-renders within the same page

- **GIVEN** an expanded card
- **WHEN** the parent session receives a streaming update that re-renders the card
- **THEN** the card SHALL remain expanded

### Requirement: Subagent card SHALL provide a popout button

The card SHALL display a popout button (`mdiOpenInNew`) in its header. Clicking it SHALL open `/session/<sessionId>/subagent/<agentId>` in a new browser tab via `window.open(url, "_blank")`.

#### Scenario: Popout opens the dedicated route

- **GIVEN** an `Agent` card with `details.agentId === "abc123"` in session `sess_42`, and `context.sessionId === "sess_42"`
- **WHEN** the user clicks the popout button
- **THEN** the browser SHALL call `window.open("/session/sess_42/subagent/abc123", "_blank")` exactly once

#### Scenario: Popout button is disabled when context.sessionId is missing

- **GIVEN** an `Agent` card whose `context.sessionId` is `undefined`
- **WHEN** the popout button is rendered
- **THEN** it SHALL be disabled and clicking it SHALL NOT call `window.open`

#### Scenario: Popout button is disabled when agentId is missing

- **GIVEN** an `Agent` card whose `details.agentId` is `undefined` (e.g. early streaming frame before the agent is registered)
- **WHEN** the popout button is rendered
- **THEN** it SHALL be disabled and clicking it SHALL NOT call `window.open`

### Requirement: The dashboard SHALL serve a popout route

The dashboard client SHALL register a route at `/session/:sessionId/subagent/:agentId` that renders `<SubagentPopoutPage>`. The page SHALL subscribe to the parent session and render `<SubagentDetailView mode="popout" />` once data is available.

#### Scenario: Route renders detail view when subagent is found

- **GIVEN** the parent session `sess_42` is subscribed and contains a `subagents` entry for `abc123`
- **WHEN** the user navigates to `/session/sess_42/subagent/abc123`
- **THEN** the page SHALL render `<SubagentDetailView>` for that subagent with a chrome header showing the parent session label

#### Scenario: Route renders 'not found' for unknown agentId

- **GIVEN** subscription is resolved and the parent session has no `abc123` entry
- **WHEN** the user navigates to `/session/sess_42/subagent/abc123`
- **THEN** the page SHALL render: "Subagent not found — it may have been cleared from the parent session's history."

#### Scenario: Route shows loading while parent subscription is in flight

- **GIVEN** the popout opens in a fresh tab and the parent session is not yet subscribed
- **WHEN** subscription has not resolved
- **THEN** the page SHALL show a "Loading parent session…" indicator until subscription resolves

#### Scenario: Route renders 'parent session not found' when subscription resolves empty

- **GIVEN** subscription resolves but the parent session is unknown to the dashboard (e.g. archived/deleted)
- **WHEN** the page renders post-resolution
- **THEN** the page SHALL render: "Parent session not found — it may have been archived or deleted. Close this tab."

### Requirement: The inspector code SHALL live in a dedicated workspace plugin package

The inspector components, types, and tests SHALL live in `packages/subagents-plugin/`. The shell SHALL import them via `@blackbelt-technology/pi-dashboard-subagents-plugin/client`. The plugin SHALL have a valid `pi-dashboard-plugin` manifest with `id: "subagents"` so the vite plugin loader discovers it.

#### Scenario: Plugin is auto-discovered at build time

- **WHEN** the dashboard runs its build (`npm run build`)
- **THEN** the vite plugin loader SHALL include `subagents` in its discovered-plugins list
- **AND** the generated `plugin-registry.tsx` SHALL include the subagents plugin's entry

#### Scenario: SubagentDetailView is importable from the plugin's public entry

- **WHEN** any consumer imports from `@blackbelt-technology/pi-dashboard-subagents-plugin/client`
- **THEN** `SubagentDetailView`, `SubagentPopoutPage`, `SubagentTimelineEntry`, `SubagentState` SHALL be exported

#### Scenario: Plugin uses UI primitives registry instead of shell components

- **WHEN** `SubagentDetailView` renders markdown content
- **THEN** it SHALL resolve the renderer via `useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent)`
- **AND** it SHALL NOT import the shell's `MarkdownContent` component directly
- **AND** tests SHALL provide a mock primitive via `withUiPrimitiveProvider`

### Requirement: `SubagentDetailView` SHALL render the timeline when `entries[]` is present

When `SessionState.subagents[agentId].entries` is a non-empty array of `SubagentTimelineEntry` objects, `<SubagentDetailView>` SHALL render each entry using kind-specific renderers (`tool`, `text`, `thinking`, `error`).

#### Scenario: Full timeline with entries

- **GIVEN** a subagent state with `entries: [{ kind: "tool", toolName: "Read", input: { path: "/x" }, output: "...", ts: 1 }, { kind: "text", text: "Done.", ts: 2 }]`
- **WHEN** `<SubagentDetailView agentId={…} />` renders
- **THEN** it SHALL render the tool entry as a click-to-expand row showing `Read` and `/x`
- **AND** it SHALL render the text entry as a markdown block containing `Done.`
- **AND** thinking entries SHALL render as collapsible rows distinct from text rows
- **AND** error entries SHALL render in error colour

### Requirement: `SubagentDetailView` SHALL gracefully degrade when `entries[]` is absent

When the producer hasn't streamed `entries[]` (e.g. user has `@tintinweb/pi-subagents` installed but not `pi-dashboard-subagents`), the detail view SHALL fall back to summary content with a footnote.

#### Scenario: Running, no entries

- **GIVEN** a subagent with `status === "running"`, `activity === "Reading src/foo.ts"`, `toolUses === 5`, no `entries`
- **WHEN** the detail view renders
- **THEN** it SHALL show the activity string and counter values
- **AND** it SHALL show a footnote: "Live timeline requires `@tintinweb/pi-subagents ≥ next version`. Showing summary."

#### Scenario: Completed, no entries

- **GIVEN** a subagent with `status === "completed"` and a `result` string, no `entries`
- **WHEN** the detail view renders
- **THEN** it SHALL render the `result` via the markdown renderer
- **AND** the upgrade footnote SHALL NOT appear (result is the user's payoff)

#### Scenario: No data at all

- **GIVEN** a subagent state that has neither `entries`, `activity`, nor `result`
- **WHEN** the detail view renders
- **THEN** it SHALL render: "No detail available yet."

### Requirement: `GetSubagentResultRenderer` SHALL include a "Show details" affordance

The `get_subagent_result` tool renderer SHALL expose a "Show details" link/button when the result card has a resolvable `agent_id`. Clicking it SHALL open the popout route in a new tab.

#### Scenario: Button opens the popout route

- **GIVEN** a `get_subagent_result` tool call whose args contain `agent_id: "abc123"` in session `sess_42`
- **WHEN** the renderer mounts with `context.sessionId === "sess_42"`
- **THEN** a "Show details" affordance SHALL be visible
- **AND** clicking it SHALL call `window.open("/session/sess_42/subagent/abc123", "_blank")` exactly once

#### Scenario: Affordance is hidden when agent_id is unresolvable

- **GIVEN** a `get_subagent_result` tool call whose args do not include a resolvable `agent_id`
- **WHEN** the renderer mounts
- **THEN** the "Show details" affordance SHALL NOT render

### Requirement: `SessionState` SHALL carry the subagent timeline

The reducer's `SubagentState` interface SHALL include an optional `entries?: SubagentTimelineEntry[]` field plus optional metadata fields (`activity`, `displayName`, `modelName`, `subagentType`, `startedAt`). The `subagent_*` event handlers SHALL read these from `data.details` when present.

#### Scenario: Reducer ignores absent entries

- **GIVEN** a `subagent_started` event whose `data.details` does not contain `entries`
- **WHEN** the reducer processes the event
- **THEN** the resulting `SubagentState.entries` SHALL be `undefined`

#### Scenario: Reducer stores entries when present

- **GIVEN** a `subagent_started` event whose `data.details.entries = [{ kind: "tool", … }]`
- **WHEN** the reducer processes the event
- **THEN** the resulting `SubagentState.entries` SHALL equal that array

#### Scenario: Cumulative replace semantics

- **GIVEN** a `SubagentState` with `entries.length === 3`
- **WHEN** a new `subagent_started` event arrives with `details.entries.length === 5`
- **THEN** the new `SubagentState.entries.length === 5`
- **AND** entries are REPLACED, not appended (the producer is expected to send the full cumulative array)

### Requirement: `ToolContext` SHALL carry sessionId for session-scoped URLs

The `ToolContext` interface SHALL include optional `sessionId?: string` and `session?: SessionState` fields. Renderers needing session-scoped URLs (e.g. popout) SHALL read these.

#### Scenario: ToolContext shape

- **WHEN** `ChatView` constructs the `toolContext` passed to renderers
- **THEN** the object SHALL include `sessionId` set to the current session id (or undefined when no session is selected)
- **AND** it SHALL include `session` set to the current `SessionState` (or undefined)

### Requirement: Reducer SHALL backfill `subagents` map from `tool_execution_end`

The reducer's `tool_execution_end` handler SHALL also populate `next.subagents` whenever the event refers to a subagent run — i.e. `data.toolName === "Agent"` AND `data.details?.agentId` is a non-empty string.

Without this, `session.subagents.get(agentId)` is empty after parent-session `/resume` and after any dashboard refresh that occurs once the subagent has completed (the only writer today is the live `subagent_*` event stream, which is NOT synthesized by `state-replay.ts`). Producers persist the full `AgentDetails` (including `entries[]`) inside the parent's `ToolResultMessage.details` per the producer contract — `state-replay.ts` already threads `msg.details` into the synthesized `tool_execution_end` event payload, so the data is available at this seam. This requirement closes the loop on the consumer side.

The handler SHALL derive `SubagentState` fields from `data.details` via the existing `readSubagentDetails(details)` helper, plus:

- `status` ← `"failed"` if `data.isError === true`, else `"completed"`.
- `result` ← `data.result` when a string and `!isError`.
- `error` ← `data.result` when `isError === true`, or `data.details.error` if present.
- `durationMs` ← `data.details.durationMs` when present.
- `tokens` ← `data.details.tokensUsage` when present (the raw `{input, output, total}` shape).
- `toolUses` ← `data.details.toolUses` when present.

When the subagent has ALREADY been recorded in `next.subagents` (e.g. a live `subagent_completed` event arrived earlier in the same session lifetime), the backfill SHALL merge rather than replace: existing fields are preserved unless the new `data.details` provides a non-undefined value. This makes the live path and the replay path commutative — the final state does not depend on event ordering.

Backfill SHALL be a no-op when `toolName !== "Agent"` or `data.details?.agentId` is absent — `tool_execution_end` events for unrelated tools MUST NOT touch the subagents map.

#### Scenario: Replayed completed subagent populates the map

- **GIVEN** a parent session JSONL containing a `ToolResultMessage` with `toolName: "Agent"`, `isError: false`, and `details: { agentId: "sub_abc", entries: [...], durationMs: 4200, tokensUsage: {input: 500, output: 200, total: 700}, displayName: "explorer" }`
- **WHEN** the dashboard subscribes to the session and `state-replay.ts` synthesizes a `tool_execution_end` event from that entry
- **THEN** after the reducer processes the event, `state.subagents.get("sub_abc")` SHALL exist
- **AND** its `status` SHALL be `"completed"`
- **AND** its `entries` SHALL equal the persisted array
- **AND** its `durationMs` SHALL be `4200`
- **AND** its `tokens` SHALL equal `{input: 500, output: 200, total: 700}`
- **AND** its `displayName` SHALL be `"explorer"`

#### Scenario: Replayed failed subagent populates the map with failed status

- **GIVEN** a `tool_execution_end` event with `toolName: "Agent"`, `isError: true`, `result: "aborted by user"`, `details: { agentId: "sub_xyz" }`
- **WHEN** the reducer processes the event
- **THEN** `state.subagents.get("sub_xyz").status` SHALL be `"failed"`
- **AND** the resulting state's `error` SHALL be `"aborted by user"`

#### Scenario: Backfill merges with prior live state without overwriting

- **GIVEN** the subagents map already contains `sub_abc` with `displayName: "liveName"` from a prior `subagent_started` event
- **WHEN** a `tool_execution_end` arrives with `details: { agentId: "sub_abc", displayName: undefined, durationMs: 1234 }`
- **THEN** the resulting `state.subagents.get("sub_abc").displayName` SHALL remain `"liveName"` (not overwritten with undefined)
- **AND** `durationMs` SHALL be updated to `1234`

#### Scenario: Backfill is a no-op for non-Agent tools

- **GIVEN** a `tool_execution_end` event with `toolName: "bash"` and `details: { foo: "bar" }` (no `agentId`)
- **WHEN** the reducer processes the event
- **THEN** `state.subagents` SHALL be unchanged

#### Scenario: Backfill is a no-op when agentId is absent

- **GIVEN** a `tool_execution_end` event with `toolName: "Agent"` but `details` lacks an `agentId` (e.g. legacy `@tintinweb/pi-subagents` payload)
- **WHEN** the reducer processes the event
- **THEN** `state.subagents` SHALL be unchanged
- **AND** `next.messages[i].toolDetails` SHALL still be populated as today (the existing `toolDetails` path is unaffected)
