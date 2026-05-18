## Why

Five independent production migrations (pi-fork rename to `@earendil-works/pi-coding-agent`, `consolidate-tool-resolution`, AppImage guard D1 expansion, `--offline` → `--prefer-offline`, recommended-extensions URL flip from `git@` → `https://`) landed without updating their downstream tests. The electron workspace now has **13 failing tests across 5 files** — `npm test` is red on a clean checkout. Every new branch starts from a broken baseline, making it impossible to tell whether subsequent work introduces new regressions or inherits this debt.

## What Changes

Test-only change. Updates assertions and mock wiring in 5 electron-workspace test files so they match current production behaviour. No production code modified. No new test cases added (covered out of scope — see follow-up note below).

- **`packages/electron/src/lib/__tests__/launch-source.smoke.test.ts`** — 4 hardcoded `@mariozechner` path segments at lines 283/316/322/324 swap to `@earendil-works`. Variable name `mzDir` left as-is (rename exceeds minimal-diff scope).
- **`packages/electron/src/__tests__/dependency-detector.test.ts`** — 7 tests: 3 fail on shape (production grew `resolution?: Resolution` field); 4 fail because mock chain no longer intercepts the new `getDefaultRegistry().resolve()` path. Adds two new module mocks (`tool-registry/index.js`, `platform/binary-lookup.js`) layered on top of existing `node:child_process` + `node:fs` mocks. Switches 3 strict `.toEqual` assertions to `.toMatchObject`. The 21 currently-passing tests in the same file MUST stay green.
- **`packages/electron/src/__tests__/dependency-detector-appimage.test.ts`** — 2 tests fail because (1) the mocked version string `"v22.11.0"` is itself in the nodejs/node#58515 affected range so the first-pass version check fails and triggers `scanForUsableNodeOnDisk()`, and (2) that fallback uses unmocked `execFileSync` which hits the host's real `/usr/bin/node`. Fix: bump mocked version to `"v22.18.0"` and mock `execFileSync` in `beforeEach`.
- **`packages/electron/src/__tests__/offline-packages.test.ts`** — 1 test: literal `"--offline"` → `"--prefer-offline"` (production switched because cross-major-version npm cache key formats are incompatible).
- **`packages/electron/src/__tests__/recommended-wizard.test.ts`** — 1 test: `"git@github.com:..."` → `"https://github.com/..."` for `pi-anthropic-messages` and `pi-flows` source URLs (the other 3 IDs in the test are `npm:*` and unchanged).

Out of scope (deferred to a separate hygiene sweep): `packages/server/src/__tests__/pi-changelog-routes.test.ts` (27 `@mariozechner` refs, 0 `@earendil-works` — silent legacy lock-in); 4 files mocking `node:child_process` directly instead of `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`. These pass today but are fragile.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — this is a test-mock refresh against unchanged production contracts; no requirement-level behaviour shifts)

## Impact

- **Code**: 5 test files under `packages/electron/src/**/__tests__/`. Approximate diff: ~70-80 lines, ~90% concentrated in `dependency-detector.test.ts` mock-setup boilerplate. Other 4 files combined ≤ 10 lines.
- **Tests**: 13 currently-failing tests turn green; 21 currently-passing detector tests must remain green (mock-bleed risk — mitigated by fail-closed `beforeEach` defaults).
- **Production**: none touched.
- **Dependencies**: none new. Uses existing `vi.hoisted` + `vi.mock` patterns already established in `dependency-detector-appimage.test.ts`.
- **CI**: `npm test` returns to green from current 4-file/4-test failure baseline (top-level invocation) and 5-file/13-test failure baseline (electron workspace direct invocation).
- **Rollback**: revert the 5 file diffs. No persisted state, no production behaviour.
- **Risk**: low. Worst case is a `beforeEach` default that leaks state into an adjacent test — caught immediately by the green/red flip and addressed by tightening the default to fail-closed.
