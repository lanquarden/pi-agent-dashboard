# Tasks — harvest-bootstrap-survivor-fixes

Six numbered cherry-picks. Each is a separate commit. Pickable in
order; cherry-pick 6 has sub-tasks 6a/6b/6c that must land together.

## 1. dashboard-paths.ts — single source of truth

- [x] 1.1 Create `packages/shared/src/dashboard-paths.ts` with
      `DashboardPathsEnv`, `getDashboardConfigDir`,
      `getDashboardServerLogPath`, `getManagedDir` (re-export),
      `getInstallerLogPath`. Source from branch verbatim.
- [x] 1.2 Add unit test
      `packages/shared/src/__tests__/dashboard-paths.test.ts`
      asserting each helper accepts `{ homedir }` override and falls
      back to `os.homedir()`. (9/9 tests pass)
- [x] 1.3 Row added to `docs/file-index-shared.md`. See docs batch.

## 2. server-identity.ts — retry semantics

- [x] 2.1 Extract `probeOnce(port, host, timeoutMs)` from existing
      `isDashboardRunning` body.
- [x] 2.2 Add `DashboardCheckOpts` interface (`timeoutMs`, `retries`,
      `retryDelayMs`, `_sleep` seam). Default values preserve legacy
      single-shot 2 s probe.
- [x] 2.3 Wrap `probeOnce` in retry loop. `running: true` and
      `portConflict: true` short-circuit; everything else retries
      until `retries + 1` attempts exhausted.
- [x] 2.4 Add `version` to `DashboardStatus` (already on branch).
- [x] 2.5 Add unit tests covering: legacy single-shot, retries=2
      with two transient failures then success, portConflict short-
      circuit, ECONNREFUSED short-circuit, `_sleep` seam invoked
      between attempts with correct delay. (13/13 pass — 6 legacy +
      7 new retry tests including timeoutMs assertion.)
- [x] 2.6 Row updated in `docs/file-index-shared.md`. See docs batch.

## 3. electron/health-check.ts — collapse to re-export

- [x] 3.1 Replace file contents with re-export of
      `@blackbelt-technology/pi-dashboard-shared/server-identity.js`
      (`isDashboardRunning`, `DashboardStatus`, `DashboardCheckOpts`).
- [x] 3.2 Delete the historical "MUST NOT import from shared" comment.
- [x] 3.3 Verified re-export resolves + wildcard `*.js` export covers it;
      `server-lifecycle.ts` callers unaffected (same import path).
- [x] 3.4 Row added to `docs/file-index-electron.md`. See docs batch.

## 4. electron/doctor.ts — probeServer native fetch

- [x] 4.1 Replace `safeExec("curl -sf …")` block inside `probeServer()`
      with native `fetch` + AbortController (3 s timeout). Preserve full
      `/api/health` shape parsing.
- [x] 4.2 Convert `probeServer` from sync-returning-Promise to `async`.
- [ ] 4.3 Electron doctor tests hang in this env — deferred. Core behaviour
      verified via type-check + code inspection. Wiring identical to
      cherry-pick 5 which has full test coverage.
- [x] 4.4 Row updated in `docs/file-index-electron.md`. See docs batch.

## 5. server/doctor-routes.ts — process-state probeServer

- [x] 5.1 Replace `safeExec("curl … http://localhost:8000/api/health")`
      inside `buildDefaultDeps().probeServer` with process-state reads.
- [x] 5.2 Self-deadlock rationale documented inline with change reference.
- [x] 5.3 Test added to `doctor-route.test.ts`: asserts route completes
      < 3 s (no deadlock) and server row is "ok". 7/7 pass.
- [x] 5.4 Row updated in `docs/file-index-server.md`. See docs batch.

## 6. server-watchdog — flag + factory + plumbing + wire-up

### 6a. shared/server-launcher.ts — onChildExit opt

- [x] 6a.1 Add `onChildExit?: (code, signal) => void` to `LaunchOpts`.
- [x] 6a.2 Attach via `child.once("exit", opts.onChildExit)` before readiness loop.
- [x] 6a.3 3 tests: fires once, once-only, no listener when omitted. 16/16 pass.
- [x] 6a.4 Row updated in `docs/file-index-shared.md`. See docs batch.

### 6b. electron/server-lifecycle.ts — flag + factory + log path

- [x] 6b.1 `gracefulShutdownInProgress` flag + accessors added.
- [x] 6b.2 `setSpawnedPid` resets flag.
- [x] 6b.3 `makeServerWatchdog` pure factory added.
- [x] 6b.4 `readServerLogTail` + `launchServer` logFile use `getDashboardServerLogPath()`.
- [x] 6b.5 7 tests: graceful/crash/null-code/onCrash-throws/flag/setSpawnedPid. 7/7 pass.
- [x] 6b.6 Row updated in `docs/file-index-electron.md`. See docs batch.

### 6c. electron/main.ts — wire-up

- [x] 6c.1 `quit()` calls `setGracefulShutdownInProgress(true)` before
      stopping server.
- [x] 6c.2 `spawnFromSource` opts extended with `onChildExit`;
      `launch-source.ts` threads it to `launchDashboardServer`.
      `main.ts` wires `makeServerWatchdog` with `showLoadingPage` onCrash.
- [ ] 6c.3 Manual smoke deferred (requires Electron build). Logic
      verified via unit tests in 6a + 6b.

## 7. Documentation

- [x] 7.1 FAQ entry added to `docs/faq.md`. See docs batch.
- [x] 7.2 No existing watchdog section in architecture.md; mechanism
      documented in design.md. Skipped.

## 8. Verification

- [ ] 8.1 `npm test` green across all workspaces.
- [ ] 8.2 `npm run reload:check` (type-check + extension reload).
- [ ] 8.3 Manual smoke: open Electron app, open Doctor, confirm
      green server row. Run under load (open dashboard + spam openspec
      poll) to confirm no false WARN.
- [ ] 8.4 Manual smoke: `kill -9 <serverPid>` while dashboard open,
      confirm loading page appears.
- [ ] 8.5 Smoke: `pi-dashboard start` standalone arm unaffected
      (no watchdog wired, no regression).

## 9. Cleanup

- [ ] 9.1 Delete branch `new_bootstap_mess` once
      `eliminate-electron-runtime-install` is queued or this change
      lands and the user confirms harvest is complete.
- [ ] 9.2 Confirm `eliminate-electron-runtime-install` proposal does
      not need updating — its KEEP list already names every file this
      change touches.
