## ADDED Requirements

### Requirement: launchDashboardServer SHALL accept an onChildExit callback

`launchDashboardServer(opts)` SHALL accept an optional `opts.onChildExit: (code: number | null, signal: NodeJS.Signals | null) => void`. When supplied, the launcher SHALL attach it via `child.on("exit", opts.onChildExit)` before the readiness loop resolves. The handler SHALL fire exactly once per spawned child. When the option is omitted, the launcher SHALL NOT attach any default exit handler — existing call sites SHALL be unaffected.

#### Scenario: onChildExit attached before resolve

- **WHEN** `launchDashboardServer({ onChildExit, ... })` is invoked
- **AND** `child = spawn(...)` succeeds
- **THEN** the launcher SHALL call `child.on("exit", onChildExit)` before entering the readiness loop
- **AND** the launcher SHALL resolve `{ childPid, reportedPid, healthOk: true }` once `/api/health` returns 200
- **AND** any post-resolve `child.emit("exit", code, signal)` SHALL invoke `onChildExit(code, signal)` exactly once

#### Scenario: onChildExit omitted preserves legacy behaviour

- **WHEN** `launchDashboardServer(opts)` is invoked without `opts.onChildExit`
- **THEN** no `child.on("exit", …)` listener SHALL be attached by the launcher
- **AND** the resolve / reject behaviour SHALL match the pre-change contract

#### Scenario: Pre-resolve early exit still throws EarlyExitError

- **WHEN** `launchDashboardServer({ onChildExit, ... })` is invoked
- **AND** the child exits before `/api/health` returns 200
- **THEN** the launcher SHALL throw `EarlyExitError(code, signal)` per existing contract
- **AND** SHALL NOT additionally invoke `onChildExit` for the same exit event

### Requirement: isDashboardRunning SHALL support optional retry semantics

`isDashboardRunning(port, host?, opts?)` SHALL accept an optional third argument `DashboardCheckOpts = { timeoutMs?, retries?, retryDelayMs?, _sleep? }`. Default values SHALL be `timeoutMs = 2000`, `retries = 0`, `retryDelayMs = 500`, preserving the legacy single-shot 2 s probe. When `retries > 0`, the probe SHALL execute up to `retries + 1` attempts, sleeping `retryDelayMs` between failures.

#### Scenario: Default invocation matches legacy behaviour

- **WHEN** `isDashboardRunning(port)` or `isDashboardRunning(port, host)` is invoked without `opts`
- **THEN** exactly one HTTP probe SHALL be made with a 2 s `AbortController` budget
- **AND** the return shape SHALL match the pre-change `DashboardStatus`

#### Scenario: Retry on transient failure

- **WHEN** `isDashboardRunning(port, host, { retries: 2, retryDelayMs: 100 })` is invoked
- **AND** the first probe times out
- **AND** the second probe times out
- **AND** the third probe returns `{ ok: true, pid: <n> }`
- **THEN** the function SHALL return `{ running: true, pid: <n> }`
- **AND** SHALL have invoked `_sleep` exactly twice with `100` between attempts

#### Scenario: portConflict short-circuits retries

- **WHEN** `isDashboardRunning(port, host, { retries: 3 })` is invoked
- **AND** the first probe returns HTTP 200 with non-dashboard JSON shape
- **THEN** the function SHALL return `{ running: false, portConflict: true }` immediately
- **AND** SHALL NOT make further probe attempts

#### Scenario: ECONNREFUSED is not retried with default retries

- **WHEN** `isDashboardRunning(port)` (no opts) is invoked
- **AND** the probe receives `ECONNREFUSED`
- **THEN** the function SHALL return `{ running: false }` without retry
