## Status

**WIP / unfinished commit.** Tasks below are checkboxed where shipped, unchecked where pending. See proposal.md for the gap list.

## 1. Reducer extensions (DONE)

- [x] 1.1 `SubagentTimelineEntry` discriminated union exported from `event-reducer.ts`.
- [x] 1.2 `SubagentState` extended with optional `entries`, `activity`, `displayName`, `modelName`, `subagentType`, `startedAt`.
- [x] 1.3 `readSubagentDetails(details)` helper pulls these from event payloads.
- [x] 1.4 `subagent_*` event handlers read `data.details` via `readSubagentDetails`.
- [x] 1.5 Unit tests in `event-reducer.test.ts` covering: absent entries, present entries, cumulative-replace semantics, startedAt stamping.

## 2. `SubagentDetailView` component (DONE)

- [x] 2.1 Created `SubagentDetailView.tsx`. Props: `session`, `agentId`, `mode` (`inline`/`popout`/`row`).
- [x] 2.2 Tier 1: renders `entries[]` as kind-specific rows (tool/text/thinking/error).
- [x] 2.3 Tier 2: running, no entries — shows activity + counters + footnote.
- [x] 2.4 Tier 3: completed/failed, no entries — shows result/error block.
- [x] 2.5 Tier 4: no useful data — "No detail available yet."
- [x] 2.6 Row mode renders single-line summary used by anyone consuming the component.
- [x] 2.7 Unit tests in `SubagentDetailView.test.tsx`.

## 3. `AgentToolRenderer` modifications (DONE)

- [x] 3.1 Local `expanded` state; expand toggle (`mdiChevronDown`/`mdiChevronUp`) in card header.
- [x] 3.2 Popout button (`mdiOpenInNew`) next to the expand toggle; disabled when `sessionId` or `agentId` is missing.
- [x] 3.3 Expanded body renders `<SubagentDetailView session={…} agentId={…} mode="inline" />` (collapses prompt/result blocks while expanded).
- [x] 3.4 Unit tests in `AgentToolRenderer.test.tsx`.

## 4. `SubagentPopoutPage` component (DONE)

- [x] 4.1 Created `SubagentPopoutPage.tsx`. Props: `sessionId`, `agentId`, `session`, `subscriptionResolved`, `parentLabel`, `onBack`.
- [x] 4.2 Renders loading / parent-not-found / subagent-not-found / detail-view states.
- [x] 4.3 Updates `document.title` to `<displayName> · <parent> · pi`.
- [x] 4.4 Unit tests in `SubagentPopoutPage.test.tsx`.

## 5. `GetSubagentResultRenderer` modification (DONE)

- [x] 5.1 "Show details" affordance rendered when `args.agent_id` + `context.sessionId` resolvable.
- [x] 5.2 Click opens `/session/<sid>/subagent/<aid>` in a new tab.
- [x] 5.3 Affordance hidden when either id is missing.
- [x] 5.4 Unit tests in `GetSubagentResultRenderer.test.tsx`.

## 6. `ToolContext` extensions (DONE)

- [x] 6.1 `ToolContext` gains optional `sessionId?: string` and `session?: SessionState`.

## 7. App.tsx route + toolContext wiring (PENDING)

- [ ] 7.1 Register `useRoute("/session/:sessionId/subagent/:agentId")` alongside the existing diff/folder/openspec routes.
- [ ] 7.2 Render `<SubagentPopoutPage>` for matched routes in BOTH the desktop layout (~line 1066) and the mobile shell layout (~line 1335).
- [ ] 7.3 Add a `useEffect` that subscribes the parent session in the popout case (so a fresh tab can load `/session/<sid>/subagent/<aid>` without needing the parent tab open elsewhere).
- [ ] 7.4 Extend the `toolContext: ToolContext` memo around line 673 to include `sessionId: selectedId` and `session: selectedState`. Renderers will then have access to both.
- [ ] 7.5 Update both render call-sites of the popout route to pass `subscriptionResolved` (derived from `status === "connected" && subscribedRef.current.has(sessionId)`) and `parentLabel` (from `sessions.get(sessionId)?.cwd`).

## 8. Cleanup (DONE)

- [x] 8.1 Removed `BackgroundSubagentsPill.tsx`, `BackgroundSubagentsPanel.tsx`, `BackgroundSubagentsPill.test.tsx`.
- [x] 8.2 Reverted `StatusBar.tsx` pill wiring.
- [x] 8.3 Trimmed `AgentToolRenderer.tsx` background status branch.
- [x] 8.4 Removed `background` from `SubagentState.status` union and removed `isBackground` field.
- [x] 8.5 Removed background-related test cases from `event-reducer.test.ts` and `SubagentDetailView.test.tsx`.

## 11. Plugin extraction (DONE)

- [x] 11.1 Created `packages/subagents-plugin/` workspace package with `package.json`, `tsconfig.json`, `pi-dashboard-plugin` manifest (`id: "subagents"`).
- [x] 11.2 `git mv` of `SubagentDetailView.tsx` + `SubagentPopoutPage.tsx` + their tests into `packages/subagents-plugin/src/client/`.
- [x] 11.3 Created `types.ts` (canonical `SubagentTimelineEntry` + `SubagentState`) and `index.tsx` barrel.
- [x] 11.4 Detached plugin from shell components by switching to `useUiPrimitive(markdownContent)` for markdown rendering.
- [x] 11.5 Shell's `event-reducer.ts` re-exports types from the plugin (single canonical source).
- [x] 11.6 Shell's `AgentToolRenderer` imports `SubagentDetailView` from the plugin.
- [x] 11.7 Added workspace dep on the plugin to `packages/client/package.json`.
- [x] 11.8 Updated plugin tests to use `withUiPrimitiveProvider` from `@blackbelt-technology/dashboard-plugin-runtime/test-support`.
- [x] 11.9 Updated `AgentToolRenderer.test.tsx` to wrap renders in `withUiPrimitiveProvider` (since the imported `SubagentDetailView` uses the primitives registry).
- [x] 11.10 Verified vite plugin-loader discovers `subagents` plugin (build output: "discovered 7 plugin(s): …, subagents, …").
- [x] 11.11 All tests pass; `npm run build` clean.

## 9. Validate (DONE for shipped portion)

- [x] 9.1 `npm test` passes for all 5 new test files (146 tests).
- [x] 9.2 `npm run build` clean.
- [x] 9.3 `openspec validate add-subagent-inspector --strict` clean.

## 10. Producer dependency

- [x] 10.1 Documented in proposal.md that `pi-dashboard-agent` v0.1.x is the producer.
- [x] 10.2 Cross-referenced the scaffold change in the other repo.
- [ ] 10.3 (FUTURE) Once `pi-dashboard-agent` v0.1.x is published, drop the upgrade-footnote from `SubagentDetailView` Tier 2 path (entries will reliably be present).

## 12. Reducer backfill from `tool_execution_end` (PENDING)

Closes the gap where `session.subagents.get(agentId)` is empty after `/resume` or page refresh, even though the producer persisted the full `AgentDetails` inside the parent's `ToolResultMessage.details`. See design.md Decision 7.

- [ ] 12.1 In `packages/client/src/lib/event-reducer.ts`, extend the existing `tool_execution_end` handler (around `event-reducer.ts:1105`) with a backfill branch that fires when `data.toolName === "Agent"` AND `(data.details as Record<string, unknown> | undefined)?.agentId` is a non-empty string.
- [ ] 12.2 Inside the branch, build a `SubagentState` patch via the existing `readSubagentDetails(details)` helper plus derived fields:
  - `status`: `"failed"` if `data.isError`, else `"completed"`
  - `result`: `data.result` (string) when `!isError`
  - `error`: `data.result` when `isError`, falling back to `data.details.error`
  - `durationMs`: `data.details.durationMs`
  - `tokens`: `data.details.tokensUsage`
  - `toolUses`: `data.details.toolUses`
- [ ] 12.3 Apply the patch with merge semantics: `next.subagents.set(agentId, mergeNonUndefined(existing ?? {}, patch))` where `mergeNonUndefined` preserves prior non-undefined fields rather than overwriting with undefined. This keeps live `subagent_*` + replay paths commutative.
- [ ] 12.4 Ensure `next.subagents = new Map(next.subagents)` is performed before the `.set(...)` so React equality comparisons detect the change (same pattern as the existing `subagent_*` handlers).
- [ ] 12.5 Backfill MUST be a no-op when `toolName !== "Agent"` or `agentId` is absent (preserve existing `tool_execution_end` behavior for unrelated tools and for `@tintinweb/pi-subagents` legacy payloads without `agentId`).
- [ ] 12.6 Unit tests in `packages/client/src/lib/__tests__/event-reducer.test.ts`:
  - Replayed completed Agent run with `entries[]` populates the subagents map with `status: "completed"` and all derived fields.
  - Replayed failed Agent run (`isError: true`) populates with `status: "failed"` and `error` from `data.result`.
  - Live `subagent_completed` followed by a later `tool_execution_end` backfill for the same `agentId` does not overwrite live-only fields (e.g. `activity` set on `subagent_started`).
  - Backfill is a no-op for `toolName: "bash"` even when `details` is present.
  - Backfill is a no-op for `toolName: "Agent"` when `details.agentId` is missing.
  - The existing `next.messages[i].toolDetails` write path remains intact (regression guard).
- [ ] 12.7 Verify end-to-end with a manual replay scenario: start the dashboard against a session JSONL that contains a completed Agent tool result with full `AgentDetails`, then click the card's expand toggle and the popout button. Both surfaces SHALL render the full timeline.
