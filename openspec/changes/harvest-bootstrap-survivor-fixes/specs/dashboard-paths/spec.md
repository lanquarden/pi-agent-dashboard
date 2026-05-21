## ADDED Requirements

### Requirement: Dashboard filesystem paths SHALL resolve through a single shared module

Every runtime read or write that targets one of the dashboard's two on-disk roots — `~/.pi/dashboard/` (config + live server log) or `~/.pi-dashboard/` (managed install dir + legacy installer log) — SHALL resolve the path through helpers exported from `packages/shared/src/dashboard-paths.ts`. The module SHALL expose at minimum `getDashboardConfigDir`, `getDashboardServerLogPath`, `getManagedDir`, and `getInstallerLogPath`. The two distinct log files (`~/.pi/dashboard/server.log` for the live server, `~/.pi-dashboard/server.log` for the legacy installer) SHALL be addressed via distinct helpers so callers cannot conflate them.

#### Scenario: Live server log path is unambiguous

- **WHEN** any caller (recovery UI, log tailer, Doctor) needs to read the live server's stdout/stderr log
- **THEN** the caller SHALL invoke `getDashboardServerLogPath()` from `dashboard-paths.ts`
- **AND** the resolved path SHALL be `<homedir>/.pi/dashboard/server.log`
- **AND** the caller SHALL NOT construct the path by `path.join` against any other root

#### Scenario: Installer log path is distinct

- **WHEN** any caller needs the legacy installer log specifically
- **THEN** the caller SHALL invoke `getInstallerLogPath()` (NOT `getDashboardServerLogPath()`)
- **AND** the resolved path SHALL be `<homedir>/.pi-dashboard/server.log`

#### Scenario: Test env override

- **WHEN** any helper is invoked with `{ homedir: "/tmp/test-home" }`
- **THEN** the resolved path SHALL anchor at `/tmp/test-home` instead of `os.homedir()`
- **AND** `os.homedir()` SHALL NOT be mutated or consulted for that invocation
