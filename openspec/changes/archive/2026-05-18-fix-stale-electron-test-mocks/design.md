## Context

The electron workspace at `packages/electron/` has 13 failing tests across 5 files on a clean checkout. Five independent production migrations landed without updating their tests:

1. **pi-fork rename** (`c1233417 feat(pi-fork)`) — primary pi package became `@earendil-works/pi-coding-agent`; `@mariozechner/pi-coding-agent` retained as legacy fallback per the resolver contract pinned in `binary-lookup-resolveJiti.test.ts`.
2. **consolidate-tool-resolution** — `DetectionResult` in `packages/electron/src/lib/dependency-detector.ts` grew an optional `resolution?: Resolution` field; detection now routes through `getDefaultRegistry().resolve(name)` and `ToolResolver.which(name)` from `@blackbelt-technology/pi-dashboard-shared/`. The original `execSync`-from-`node:child_process` was replaced by the shared `platform/exec.js` re-export.
3. **AppImage guard D1** (`fix-electron-appimage-cli-self-detection`) — `isAppImageSelfHit` now applies three rules (realpath==execPath, under `APPDIR`, realpath==`APPIMAGE`). On rejection, `detectSystemNode` no longer fails closed — it falls through to `scanForUsableNodeOnDisk()`, which probes `~/.nvm`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `/usr/bin` using **`execFileSync` from `node:child_process` directly** (not the platform abstraction).
4. **offline-packages flag** — `buildOfflineInstallArgs` switched from `--offline` (strict) to `--prefer-offline` to tolerate npm-major-version cache-key incompatibilities between build-time and runtime.
5. **recommended-extensions URL flip** — `BlackBeltTechnology/{pi-anthropic-messages,pi-flows}.git` source strings flipped from `git@github.com:` SCP form to `https://github.com/` URL form.

`npm test` is red on every fresh branch. Untrue red obscures real regressions.

Constraints:
- **Test-only**. Production code is correct; the tests are stale.
- **Minimal diff**. No new test cases, no regression dual-coverage forks, no rewrites of existing setup. Layer new mocks **on top of** existing setup.
- **No mock bleed**. The 21 currently-passing tests in `dependency-detector.test.ts` must stay green. Mock defaults must fail-closed in `beforeEach`.
- **No production touched**.

## Goals / Non-Goals

**Goals:**
- Restore `npm test` to green from the 13-failure baseline.
- Preserve test intent — each fix asserts the same property the test was already asserting, just against the current production reality.
- Use only patterns already established in the repo (look at `dependency-detector-appimage.test.ts` for the registry-mock pattern; `vi.hoisted` is already the house style).

**Non-Goals:**
- Adding regression coverage for legacy `@mariozechner` fallback paths in the touched tests. (`binary-lookup-resolveJiti.test.ts` already pins that contract for the resolver; duplicating it in every consumer test is over-scope.)
- Renaming local variables (`mzDir` is a misnomer post-fix but stays).
- Fixing the wider silent-debt landscape — see follow-up note.
- Refactoring the test mock setup to a shared helper. One-shot test repair, not infrastructure work.
- Changing any production module.

## Decisions

### D1. Layer new mocks rather than replace existing setup

`dependency-detector.test.ts` currently mocks `node:child_process`, `node:fs`, and `@blackbelt-technology/pi-dashboard-shared/platform/npm.js`. Production now ALSO routes through `tool-registry/index.js` and `platform/binary-lookup.js`. Two options:

- **A (chosen)**: Add `vi.mock(...)` for the two new modules; keep all existing mocks; add a `beforeEach` block that resets all five mock surfaces to fail-closed defaults.
- B: Tear out the existing mocks and route everything through a single registry mock.

Rationale: B breaks the 21 currently-passing tests that depend on the existing `mockExecSync`/`mockExistsSync` behaviour. A is additive — strictly more powerful, strictly safer. Diff is ~25 lines of skeleton + ~5 lines per touched test = ~60–70 lines.

### D2. `.toEqual` → `.toMatchObject` for shape drift

Three `detectPi`/`detectSystemNode` assertions use strict `.toEqual({found, path, source})`. Production now also returns `resolution?: Resolution`. Switch to `.toMatchObject` so the new field doesn't break the assertion. This is the documented pattern for "production grew a field, test pinned the old shape".

Alternative considered: strip the `resolution` field from the result before comparing. Rejected: more code, hides intent, drift-prone.

### D3. Bucket C (AppImage) — fix the mocked version + mock `execFileSync`

The 2 failing AppImage tests have two root causes stacked:
- The mocked version string `"v22.11.0"` is in the nodejs/node#58515 affected range (v22.0–22.17). Production's version check rejects it, which triggers the `scanForUsableNodeOnDisk()` fallback.
- That fallback uses `execFileSync` from `node:child_process` — a separate import from the `execSync` the test mocks. The fallback hits the real host's `/usr/bin/node`.

Fix: change the mocked version to `"v22.18.0"` (just outside the affected range) AND add a `mockExecFileSync` returning the same version. With the version OK, the first-pass path is accepted directly (test #2) or, when the guard rejects it, the fallback's candidates all exist? No — `mockExistsSync` in `beforeEach` defaults false, so `scanForUsableNodeOnDisk` finds no candidates and returns null. `detectSystemNode` returns `{found:false}` (test #1). ✓

Alternative considered: make the test pass by using `vi.unmock` on `node:child_process`. Rejected: leaks real-system behaviour into the test, non-deterministic across machines.

### D4. Bucket A (smoke test) — pure string replace, variable name unchanged

4 hardcoded `@mariozechner` path segments → `@earendil-works`. The local variable `mzDir` (originally "mariozechner dir") becomes a misnomer but renaming it touches ~10 more lines for zero behavioural value. Out of scope.

### D5. Buckets D and E — pure string flips

Single literal replacements. No mock changes. No structural risk.

### D6. Defer the wider silent-debt sweep

The parallel exploration found ~7 additional files with silent debt against the same 5 migrations — most notably `packages/server/src/__tests__/pi-changelog-routes.test.ts` (27 `@mariozechner` refs, 0 `@earendil-works`, HIGH risk if pi.dev metadata rename happens). These pass today and the user scoped this change to "make the 13 failing tests pass". Capture as a separate proposal `fix-test-mock-boundary-debt` (or similar) — not bundled here, to keep this diff reviewable.

## Risks / Trade-offs

- **[Mock bleed into the 21 passing detector tests]** → Mitigate by setting all five mock surfaces to fail-closed defaults in `beforeEach`: `mockHas.mockReturnValue(false)`, `mockResolve.mockImplementation(() => ({ok:false,path:null,source:null,tried:[],resolvedAt:Date.now()}))`, `mockWhich.mockReturnValue(null)`. Each previously-passing test will need to **opt in** by setting up the mocks it cares about; the existing tests that pass do so because they don't depend on the new mock surfaces — defaults are inert for them.
- **[Variable name `mzDir` is now a lie]** → Accept. Code comment already says "// nuke the @earendil-works subtree" after the fix; reader can follow the comment.
- **[`mockExecFileSync` in AppImage tests might affect Test 2's positive path]** → Verified by walking the production flow: positive path returns `base` directly before the version check fallback, so `execFileSync` is never invoked. The mock is inert for Test 2 and active for Test 1. Both pass.
- **[`.toMatchObject` is less strict than `.toEqual` — could miss an unwanted field]** → Acceptable. The fields we care about are explicitly enumerated; extra fields like `resolution` are intentional production additions. If a future change pollutes the result with garbage, a different mechanism (lint, schema) is the right gate, not test-shape strictness.
- **[Silent debt left in `pi-changelog-routes.test.ts`]** → Captured in proposal "out of scope" note. Risk is "would break on pi.dev metadata flip" — that flip hasn't happened. Acceptable to defer.

## Migration Plan

1. Apply the 5 file diffs in order: trivial → harder (A, D, E, C, B). Each bucket independently green; no cross-file coupling.
2. After each bucket, run `cd packages/electron && HOME=$(mktemp -d) npx vitest run <specific-file>` to confirm green before moving on.
3. After all 5 done, run `npm test` from repo root to confirm baseline green.
4. Rollback: `git checkout HEAD -- packages/electron/src/**/__tests__/*.test.ts` — no other state to revert.

## Open Questions

None — every fix is grounded in the verified production behaviour and the existing mock patterns. The wider silent-debt scope is intentionally out and tracked in a follow-up.
