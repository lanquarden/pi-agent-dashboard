## MODIFIED Requirements

### Requirement: Server-status probe SHALL NOT subprocess

The Doctor server-status probe SHALL determine server liveness without spawning a subprocess. Specifically:

- Inside the dashboard server itself (`packages/server/src/routes/doctor-routes.ts`), the probe SHALL read process-resident state (`process.env.DASHBOARD_STARTER`, `process.env.NODE_ENV`, `process.env.DASHBOARD_INSTALLABLE_*`) and SHALL NOT shell out to any HTTP client (curl/wget/fetch-via-subprocess). Rationale: the call site is itself handling an HTTP request, so the server is by definition running; a self-directed HTTP probe via `execSync` produces a deterministic event-loop self-deadlock.
- Inside the Electron Doctor window (`packages/electron/src/lib/doctor.ts`), the probe SHALL use native `fetch` with an `AbortController` budget of 3 s and SHALL NOT shell out to `curl` via `safeExec`. Rationale: shell-out introduces PATH lookup, sandbox transients, and `execSync` timeout semantics — all sources of false-negative WARN reports while the server is actually healthy.

#### Scenario: Server-side probe never spawns

- **WHEN** `GET /api/doctor` is handled inside the dashboard server process
- **AND** the registered `probeServer` dep is invoked
- **THEN** no child process SHALL be spawned during the probe
- **AND** the probe SHALL return `{ running: true, starter, mode, installable }` derived from process state

#### Scenario: Electron Doctor probe uses fetch

- **WHEN** the Electron Doctor window calls `probeServer()`
- **AND** the dashboard server is reachable on `http://localhost:<port>/api/health`
- **THEN** the probe SHALL issue a native `fetch` request with `AbortController` (3 s timeout)
- **AND** SHALL NOT invoke `safeExec`, `execSync`, or any subprocess primitive
- **AND** SHALL return `{ running: true, version, mode, starter, installable }` populated from the parsed `/api/health` body

#### Scenario: Electron Doctor probe timeout

- **WHEN** the Electron Doctor window calls `probeServer()`
- **AND** `/api/health` does not respond within 3 s
- **THEN** the `AbortController` SHALL fire
- **AND** the probe SHALL return `{ running: false }`
- **AND** no orphan subprocess SHALL remain after the probe returns

#### Scenario: Electron Doctor probe malformed body

- **WHEN** the Electron Doctor window calls `probeServer()`
- **AND** `/api/health` returns HTTP 200 with a body that fails to parse as JSON
- **THEN** the probe SHALL return `{ running: true }` (server is up but health shape unknown)
- **AND** SHALL NOT throw
