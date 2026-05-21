## Why

Branch `new_bootstap_mess` (note the typo in `bootstap`) carries a single
WIP commit `9a984c37` plus the `eliminate-electron-runtime-install`
exploration record (`docs/bootstrap.md`, proposal, design). The WIP commit
mixes two classes of change:

1. **Defect fixes against soon-to-be-deleted machinery**
   (`recovery-ipc.ts`, `force-reinstall.ts`, `dependency-installer.ts`,
   `offline-packages.ts`). These are slated for removal under
   `eliminate-electron-runtime-install`. Adopting them costs work that
   then has to come back out.

2. **Defect fixes against load-bearing code that survives**
   (`doctor.ts`, `doctor-routes.ts`, `server-identity.ts`, plus a new
   `dashboard-paths.ts`). These remain valid regardless of whether
   `eliminate-electron-runtime-install` lands, and several represent
   real production failures observed in HEAD today.

This change harvests **only class 2** — the survivors. It is preparatory
cleanup that converges with `eliminate-electron-runtime-install` rather
than competing with it, and provides immediate value on every install
arm (bridge / standalone / Electron) without depending on the larger
elimination landing first.

Five concrete bugs in HEAD that this change fixes:

| Bug | Symptom |
|---|---|
| `safeExec("curl … /api/health")` inside `/api/doctor` | execSync blocks event loop while curl waits for *this* process to respond. Self-deadlock. After 3 s timeout, Doctor falsely reports server "Not running" under load. |
| Electron Doctor probes server via `safeExec("curl …")` | Same shell-out fragility (PATH, sandbox, transient timeout). Native `fetch` removes the subprocess. |
| `isDashboardRunning` 2 s single-shot probe | Pre-wizard probe in Electron main fires while a previous server may still be mid-bootstrap. jiti TS transpile + cold cache extraction can block the event loop 5–15 s. False negative drives spurious second-spawn attempts. |
| `readServerLogTail` reads `~/.pi-dashboard/server.log` (legacy installer log) | Live server writes to `~/.pi/dashboard/server.log`. Recovery UI surfaces stale May-8 content on a May-16 launch. |
| Server-child crash silently ignored | `launchDashboardServer` discards the `ChildProcess` reference. Post-readiness crash never routes the user to recovery UI. |

## What Changes

### Cherry-pick 1 — `packages/shared/src/dashboard-paths.ts` (new file)

Single source of truth helpers:

- `getDashboardConfigDir()` → `~/.pi/dashboard/`
- `getDashboardServerLogPath()` → `~/.pi/dashboard/server.log`
- `getManagedDir()` → re-exported from existing `managed-paths.ts`
- `getInstallerLogPath()` → `~/.pi-dashboard/server.log` (named distinctly
  so callers cannot conflate it with the live server log)

All accept an optional `DashboardPathsEnv = { homedir? }` so tests
re-root without mutating `os.homedir()`.

### Cherry-pick 2 — `packages/shared/src/server-identity.ts` (extend)

Add optional `DashboardCheckOpts`:

```ts
interface DashboardCheckOpts {
  timeoutMs?: number;     // default 2000 — preserves legacy
  retries?: number;       // default 0  — preserves legacy
  retryDelayMs?: number;  // default 500
  _sleep?: (ms: number) => Promise<void>; // test seam
}
```

`portConflict: true` short-circuits the retry loop (deterministic
conflict, retrying would mask a real collision). `ECONNREFUSED` is *not*
retried (no process to talk to). Default call signature `(port, host?)`
is unchanged so every existing call site is unaffected.

### Cherry-pick 3 — `packages/electron/src/lib/health-check.ts` (collapse)

Replace the duplicate `isDashboardRunning` implementation with a thin
re-export of `@blackbelt-technology/pi-dashboard-shared/server-identity.js`.
Delete the historical "MUST NOT import from shared" comment — packaged
Electron resolves shared submodules fine (other lib/ files already do).

Net: one probe implementation across server + Electron main.

### Cherry-pick 4 — `packages/electron/src/lib/doctor.ts` (probeServer)

Replace `safeExec("curl -sf http://localhost:8000/api/health …")` with
native `fetch` + `AbortController` (3 s budget). Removes subprocess +
PATH lookup + execSync timeout semantics. Preserves the full
`/api/health` shape parsing (version / mode / starter / installable).

### Cherry-pick 5 — `packages/server/src/routes/doctor-routes.ts` (probeServer)

Inside the dashboard server itself, stop shelling out to `curl` against
`http://localhost:8000`. The call site is currently handling an HTTP
request — by definition the server is running. Read process-resident
health data directly:

```ts
return {
  running: true,
  starter: process.env.DASHBOARD_STARTER ?? null,
  mode: process.env.NODE_ENV === "development" ? "dev" : "production",
  installable: <from DASHBOARD_INSTALLABLE_* env>,
};
```

Eliminates the execSync self-deadlock.

### Cherry-pick 6 — server-lifecycle watchdog (the gnarly one)

Three coupled pieces:

**6a. `packages/shared/src/server-launcher.ts` — `onChildExit` plumbing**

Add to `LaunchOpts`:

```ts
onChildExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
```

Attached inside `launchDashboardServer` via `child.on('exit', …)` before
the readiness loop resolves. Idempotent — handler fires once. No
behaviour change when `onChildExit` is omitted.

**6b. `packages/electron/src/lib/server-lifecycle.ts` — flag + factory**

```ts
let gracefulShutdownInProgress = false;
export function setGracefulShutdownInProgress(v: boolean): void;
export function isGracefulShutdownInProgress(): boolean;

export function makeServerWatchdog(deps: {
  isGraceful: () => boolean;
  log: (msg: string) => void;
  onCrash: (code, signal) => void;
}): (code, signal) => void;
```

`setSpawnedPid(pid)` resets the graceful flag (re-arms watchdog for
programmatic restart). `readServerLogTail` switches from
`path.join(MANAGED_DIR, "server.log")` to `getDashboardServerLogPath()`
(depends on cherry-pick 1).

**6c. `packages/electron/src/main.ts` — wire-up**

- `before-quit` handler: `setGracefulShutdownInProgress(true)`
- `spawnFromSource` call forwards `onChildExit = makeServerWatchdog({
    isGraceful: isGracefulShutdownInProgress,
    log: appendDashboardLog,
    onCrash: () => showLoadingPage(mainWindow, serverUrl),
  })`

### What this change does NOT include (deliberately deferred)

- `LaunchStatus` recovery-phase variants (`reinstalling | wiping |
  force-reinstalling`) — these phases die under
  `eliminate-electron-runtime-install`. Adopting them is wasted churn.
- `ensureServer` power-user mode-branch removal — couples with
  `wizard-state.ts` collapse; belongs in a separate change (likely
  folded into `eliminate-electron-runtime-install`'s wizard slim).
- `recovery-ipc.ts`, `force-reinstall.ts`, `installable-catalog.ts`,
  `preflight-reconcile.ts`, audit-log, legacy-cleanup, npm-install-flag
  fixes — all on the `eliminate-electron-runtime-install` DELETE list.
- The 1037-line `wizard.html` rewrite from the branch — slim wizard is
  out of scope here.

## Capabilities

### Modified Capabilities

- `server-identity` — `isDashboardRunning` gains optional retry semantics
  (backwards-compatible). Defaults preserve single-shot 2 s probe.

### Added Capabilities

- `dashboard-paths` — single-source path helpers
  (`getDashboardConfigDir`, `getDashboardServerLogPath`, `getManagedDir`,
  `getInstallerLogPath`) replacing scattered `path.join(os.homedir(),
  ".pi-dashboard"/".pi/dashboard", …)` call sites.
- `server-watchdog` — graceful-shutdown flag + `makeServerWatchdog`
  factory + `onChildExit` plumbing in `launchDashboardServer`. Crashed
  server children route to recovery UI; graceful exits do not.

## Interaction with `eliminate-electron-runtime-install`

Every file this change touches is on that proposal's **KEEP** list:

| This change touches | Disposition under eliminate-electron-runtime-install |
|---|---|
| `shared/dashboard-paths.ts` | KEEP — Failure 3 single-source paths |
| `shared/server-identity.ts` | KEEP — Failure 4 retry-aware probe |
| `shared/server-launcher.ts` | KEEP — sole spawn primitive across all arms |
| `electron/health-check.ts` | KEEP (becomes thin re-export) |
| `electron/doctor.ts` | KEEP — read-only diagnostics survive |
| `electron/server-lifecycle.ts` | KEEP — watchdog respawn = Failure 5 |
| `electron/main.ts` | SIMPLIFY — kept, simplified further by elimination |
| `server/routes/doctor-routes.ts` | KEEP — `/api/doctor` survives |

No file overlap with the DELETE list. When `eliminate-electron-runtime-install`
lands, this change's commits stay as-is; the elimination subtracts
adjacent deleted machinery.

## Impact

### Code added
- `~70 LOC` — `dashboard-paths.ts` (new file)
- `~50 LOC` — `server-identity.ts` retry loop + probeOnce extraction
- `~25 LOC` — `server-lifecycle.ts` flag + factory
- `~15 LOC` — `server-launcher.ts` onChildExit plumbing
- `~10 LOC` — `main.ts` wire-up

### Code removed
- `~30 LOC` — duplicate `isDashboardRunning` in `health-check.ts`
- `~5 LOC` — curl shell-out inside `doctor-routes.ts` (server self-probe)
- `~3 LOC` — curl shell-out inside `electron/doctor.ts` (Doctor server probe)

### Net
- `+~135 LOC`, `-~40 LOC` → ~95 LOC net add
- Five user-facing defects eliminated
- One duplicate probe implementation collapsed

### Performance
- Eliminates one `execSync(curl)` per `/api/doctor` invocation (3 s
  worst-case event-loop block under load).
- Eliminates one `execSync(curl)` per Electron Doctor open.
- No new hot-path overhead — retry loop only fires on probe failure.

### Risk
- Low. All five cherry-picks are additive or replace specific syscalls
  with their native equivalents. Default call signatures preserved.
  Test seams (`_sleep`, `_fs`) allow hermetic coverage of the new
  branches.
