## 1. Tests (TDD)

- [x] 1.1 Add unit test for the gate predicate. Create a small pure helper (e.g. `shouldApplyDefaultModel({ reason, entryCount, hasModelRegistry, hasDefaultModel }): boolean`) in `packages/extension/src/bridge-default-model-gate.ts` so the rule is testable without booting the bridge. Test cases:
  - `reason="startup"`, `entryCount=0`, registry+default present → `true`
  - `reason="startup"`, `entryCount=5`, registry+default present → `false` (resume/fork)
  - `reason="new"`, `entryCount=0` → `false` (in-process new — pi handles its own default)
  - `reason="resume"`, `entryCount=5` → `false`
  - `reason="fork"`, `entryCount=5` → `false`
  - `reason="reload"`, `entryCount=5` → `false`
  - `reason="startup"`, `entryCount=0`, `hasDefaultModel=false` → `false`
  - `reason="startup"`, `entryCount=0`, `hasModelRegistry=false` → `false`
- [x] 1.2 Verify tests fail against current bridge logic (or against an inline copy of the current condition) before implementing the fix.

## 2. Implementation

- [x] 2.1 Create `packages/extension/src/bridge-default-model-gate.ts` exporting `shouldApplyDefaultModel(args)` implementing the truth table from 1.1.
- [x] 2.2 In `packages/extension/src/bridge.ts` `session_start` handler (~L1462), replace the inline `if (_event?.reason === "startup" && cachedModelRegistry)` check with a call to `shouldApplyDefaultModel(...)` passing `reason`, `ctx.sessionManager.getEntries()?.length ?? 0`, `Boolean(cachedModelRegistry)`, and `Boolean(loadConfig().defaultModel)`.
- [x] 2.3 Ensure the deferred retry path (`pendingDefaultModel` at ~L1693-1694) is naturally inert for resumed/forked sessions: when the gate returns `false` at session_start, leave `pendingDefaultModel = null` so the retry has nothing to apply.
- [x] 2.4 Update the inline comment above the gate to reflect the new rule: "Apply default model only on brand-new sessions (entries empty). Resume and fork keep their existing model."

## 3. Verification

- [x] 3.1 Run `npm test` and confirm all tests (including 1.1) pass. Pipe to `/tmp/pi-test.log` and grep for failures per AGENTS.md.
- [ ] 3.2 Manual smoke (user): spawn a brand-new session with `defaultModel` set in config → confirm the configured default is applied (status bar reflects it).
- [ ] 3.3 Manual smoke (user): pick a different model in the new session, send a message so it's persisted, end the session, resume from the dashboard → confirm the chosen model is preserved (NOT overwritten by `defaultModel`).
- [ ] 3.4 Manual smoke (user): fork the resumed session from the dashboard → confirm the fork inherits the parent's model.
- [ ] 3.5 Manual smoke (user): trigger `/reload` on an in-flight session that has prior messages → confirm the current model is preserved.
- [x] 3.6 Type-check verified clean for touched files (bridge.ts + new gate). Full `reload:check` left for user to run when ready to push to live sessions.

## 4. Docs

- [x] 4.1 Add a one-line row for `packages/extension/src/bridge-default-model-gate.ts` to `docs/file-index-extension.md` per the Documentation Update Protocol in AGENTS.md (caveman style). Delegate the docs edit to a general-purpose subagent.
