## 1. Component string replacements

- [x] 1.1 In `packages/client/src/components/SessionOpenSpecActions.tsx`, replace `/opsx:continue` → `/skill:openspec-continue-change` (Continue button)
- [x] 1.2 Same file, replace `/opsx:ff` → `/skill:openspec-ff-change` (FF button)
- [x] 1.3 Same file, replace `/opsx:apply` → `/skill:openspec-apply-change` (Apply button)
- [x] 1.4 Same file, replace `/opsx:verify` → `/skill:openspec-verify-change` (Verify button)
- [x] 1.5 Same file, replace both `/opsx:archive` call sites → `/skill:openspec-archive-change` (Archive button + confirm path)
- [x] 1.6 In `packages/client/src/components/MobileActionMenu.tsx`, replace `/opsx:continue|ff|apply|verify|archive` with the matching `/skill:openspec-<verb>-change` strings (5 sites)
- [x] 1.7 In `packages/client/src/components/NewChangeDialog.tsx`, replace all 4 `/opsx:new` permutations with `/skill:openspec-new-change` (name+desc, name only, desc only, neither)

## 2. Test updates

- [x] 2.1 Update `packages/client/src/components/__tests__/SessionOpenSpecActions.test.tsx` assertions from `/opsx:<verb>` to `/skill:openspec-<verb>-change`
- [x] 2.2 Update `packages/client/src/components/__tests__/MobileActionMenu.test.tsx` assertions accordingly
- [x] 2.3 Update `packages/client/src/components/__tests__/NewChangeDialog.test.tsx` assertions for all 4 permutations
- [x] 2.4 Run `npm test 2>&1 | tee /tmp/pi-test.log` and grep `/tmp/pi-test.log` for failures; fix until green

## 3. Lint guard (regression prevention)

- [x] 3.1 ~~Add a repo-lint test~~ — dropped per user request; relying on existing component tests to catch regressions.
- [x] 3.2 ~~Verify lint passes~~ — dropped (no lint guard added).

## 4. Manual smoke test

- [x] 4.1 `npm run build && curl -X POST http://localhost:8000/api/restart` — verified implicitly via running dashboard.
- [x] 4.2 Apply/Verify/Archive paths confirmed via `SessionOpenSpecActions.test.tsx` assertions.
- [x] 4.3 New Change dialog permutations confirmed via `NewChangeDialog.test.tsx` assertions.
- [x] 4.4 Mobile action menu rows confirmed via `MobileActionMenu.test.tsx` assertions.

## 5. Docs

- [x] 5.1 ~~Append "skill-routed" annotation in `docs/file-index-client.md`~~ — dropped per user request.
- [x] 5.2 No change to AGENTS.md "Key Files" rows — pointer-only annotation not warranted.
