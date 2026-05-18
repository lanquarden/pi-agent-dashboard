## 1. Bucket A — launch-source.smoke.test.ts (4 string sites)

- [x] 1.1 In `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts` line 283, change `"@mariozechner"` → `"@earendil-works"` (inside the `path.join(ctx.managedDir, "node_modules", ..., "pi-coding-agent", "package.json")` literal).
- [x] 1.2 At line 316, update the comment "// Simulate AV / partial corruption: nuke the @mariozechner subtree" → "// Simulate AV / partial corruption: nuke the jiti package" (revised: jiti got hoisted to top-level node_modules, so nuking @earendil-works subtree no longer removes jiti).
- [x] 1.3 At line 322, change `"@mariozechner"` → `"jiti"` (nuke target is top-level node_modules/jiti, the actual hoisted location).
- [x] 1.4 At line 324, update the assertion message `"precondition: @mariozechner present"` → `"precondition: jiti present"`.
- [x] 1.5 Leave the local variable name `mzDir` unchanged (rename is out of scope).
- [x] 1.6 Run `cd packages/electron && HOME=$(mktemp -d) npx vitest run src/lib/__tests__/launch-source.smoke.test.ts` — confirmed: 4 passed, 1 intentionally skipped, both previously-failing tests now green.

## 2. Bucket D — offline-packages.test.ts (1 string site)

- [x] 2.1 In `packages/electron/src/__tests__/offline-packages.test.ts` line 244 (inside `expect(argv).toEqual([...])`), change the literal `"--offline"` → `"--prefer-offline"`.
- [x] 2.2 Run `cd packages/electron && HOME=$(mktemp -d) npx vitest run src/__tests__/offline-packages.test.ts` — confirmed: 19 passed.

## 3. Bucket E — recommended-wizard.test.ts (2 string sites)

- [x] 3.1 In `packages/electron/src/__tests__/recommended-wizard.test.ts` (around lines 73–76), change `"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git"` → `"https://github.com/BlackBeltTechnology/pi-anthropic-messages.git"`.
- [x] 3.2 In the same file, change `"git@github.com:BlackBeltTechnology/pi-flows.git"` → `"https://github.com/BlackBeltTechnology/pi-flows.git"`.
- [x] 3.3 Leave the three `npm:*` assertions (`tintinweb-pi-subagents`, `pi-web-access`, `pi-agent-browser`) untouched.
- [x] 3.4 Run `cd packages/electron && HOME=$(mktemp -d) npx vitest run src/__tests__/recommended-wizard.test.ts` — confirmed: 7 passed.

## 4. Bucket C — dependency-detector-appimage.test.ts (mock setup + version bump)

- [x] 4.1 Add `mockExecFileSync` to the existing `vi.hoisted(() => ({ ... }))` block at the top of `packages/electron/src/__tests__/dependency-detector-appimage.test.ts`. Also added `mockExistsSync` + `mockReaddirSync` because `scanForUsableNodeOnDisk` also reads `node:fs`.
- [x] 4.2 Add `vi.mock("node:child_process", () => ({ execFileSync: mockExecFileSync }))` AND `vi.mock("node:fs", () => ({ existsSync: mockExistsSync, readdirSync: mockReaddirSync }))` alongside the existing module mocks. Keep the registry + platform/exec + platform/npm mocks intact.
- [x] 4.3 In the `beforeEach` block of the `describe("detectSystemNode AppImage symmetry guard", ...)` suite, change `mockExecSync.mockReturnValue("v22.11.0\n")` → `mockExecSync.mockReturnValue("v22.18.0\n")` (outside the nodejs/node#58515 affected range).
- [x] 4.4 In the same `beforeEach`, add `mockExecFileSync.mockReturnValue("v22.18.0\n")` AND `mockExistsSync.mockReturnValue(false)` AND `mockReaddirSync.mockReturnValue([])` so the `scanForUsableNodeOnDisk()` fallback receives a non-affected version but no disk candidates. Also changed test #1's `expect(result).toEqual({found:false})` → `.toMatchObject({found:false})` because production grew a `resolution` field.
- [x] 4.5 Run `cd packages/electron && HOME=$(mktemp -d) npx vitest run src/__tests__/dependency-detector-appimage.test.ts` — confirmed: 4 passed.

## 5. Bucket B — dependency-detector.test.ts (shape + 3-mock setup)

- [x] 5.1 Extend the existing `vi.hoisted(() => ({ ... }))` block with three new mock functions: `mockResolve`, `mockHas`, `mockWhich`.
- [x] 5.2 Add `vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({ getDefaultRegistry: () => ({ has: mockHas, resolve: mockResolve }) }))`.
- [x] 5.3 Add `vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", ...)` with `vi.importActual` so REAL `isAppImageSelfHit` is preserved (the detectPiDashboardCli AppImage tests depend on it). Only `ToolResolver` is replaced.
- [x] 5.4 In `beforeEach`, set fail-closed defaults: `mockHas.mockReturnValue(false)`, `mockResolve.mockImplementation(() => ok:false)`, `mockWhich.mockReturnValue(null)`.
- [x] 5.5 Test "detectPi > finds pi on system PATH": added `mockHas(true)` + `mockResolve(...system path...)` and switched `.toEqual` → `.toMatchObject`.
- [x] 5.6 Test "detectPi > finds pi via login shell": replaced the call-count-based mock with `mockHas(true)` + `mockResolve(...nvm path...)`. Original `execSync` call-count premise no longer holds because production now goes through the registry.
- [x] 5.7 Test "detectPi > finds pi in managed install": `mockHas(true)` + `mockResolve(source:"managed")`.
- [x] 5.8 Test "detectPi > returns not found": relies on beforeEach defaults (mockHas=false short-circuits detect()). Changed `.toEqual({found:false})` → `.toMatchObject({found:false})`.
- [x] 5.9 Test "detectSystemNode > finds node with sufficient version": `.toMatchObject` + `mockHas`/`mockResolve` setup. Updated mocked version from `"v22.11.0"` (affected) to `"v22.18.0"` (passes the nodejs/node#58515 gate).
- [x] 5.10 Test "detectSystemNode > rejects node with version too low": `.toMatchObject` + `mockHas`/`mockResolve` setup. Production falls through to `scanForUsableNodeOnDisk()` which finds nothing because `mockExistsSync` defaults to false.
- [x] 5.11 Test "detectBridgeExtension > falls back to npm global": added `mockWhich(name=>npm path)` so `resolver.which("npm")` returns a value and the npm-global path probe runs.
- [x] 5.12 Run vitest — confirmed: **22/22 passed** (file actually has 22 tests, not 28 as my earlier count assumed).

## 6. Full-workspace verification

- [x] 6.1 Run `cd packages/electron && HOME=$(mktemp -d -t pi-elec-test-XXXXXX) npx vitest run` — confirmed: **34/34 test files green, 280 tests passed, 1 intentionally skipped**. All 5 touched files green; no other workspace files affected.
- [x] 6.2 Run `npm test` from the repo root — confirmed: 3 failed (down from 4) | 583 passed | 2 skipped. The 3 remaining failures (`no-direct-child-process.test.ts`, `plugin-bridge-register-extended.test.ts`, `plugin-bridge-register.test.ts`) are pre-existing in the shared workspace and unrelated to this change. **0 new failures introduced**.
- [x] 6.3 Spot-check the `dependency-detector.test.ts` test count: actual file has **22 total tests** (4 detectPi + 2 detectSystemNode + 1 detectDashboardPackage + 8 detectBridgeExtension + 6 detectPiDashboardCli, plus 1 misc) — the proposal's "21 + 7 = 28" assumption was off because some test names overlapped categories. Final result: **22/22 green**, no mock bleed.

## 7. Cleanup

- [x] 7.1 Confirmed only the 5 expected test files modified by this change: `launch-source.smoke.test.ts` (+7/-6), `offline-packages.test.ts` (+1/-1), `recommended-wizard.test.ts` (+2/-2), `dependency-detector-appimage.test.ts` (+29/-3), `dependency-detector.test.ts` (+106/-24). Total ~145 insertions / ~36 deletions. Other modified files in `git status` (launch-source.ts, launch-source.test.ts, pi-dashboard.mjs, pi-package-resolver.ts) are from the user's parallel `fix-electron-cold-launch-probe-cascade` work — NOT touched by this change.
- [x] 7.2 Confirmed no production code under `packages/electron/src/lib/` (or anywhere else) touched by this change. Only `__tests__/` directories modified.
- [x] 7.3 Confirmed no `package.json` changes.
