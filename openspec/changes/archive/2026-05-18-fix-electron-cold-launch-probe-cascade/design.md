## Context

`selectLaunchSource()` (V2 LaunchSource resolver introduced by `simplify-electron-bootstrap-derived-state`) decides where to find the dashboard server on every Electron launch. The chain is `attach → devMonorepo → piExtension → npmGlobal → extracted`. Each source has its own probe; the first probe to succeed wins.

On a maintainer's Arch Linux box with `pi 0.74.x` installed via nvm and `pi-dashboard 0.5.3` installed via npm-global, a cold `.desktop` launch reliably falls through to `extracted`, and `extracted` then fails with `JitiNotFoundError` despite jiti being trivially reachable via the system-pi anchor in `ToolResolver.resolveJiti`. The initial assumption — "GUI Electron has minimal PATH; probes can't see `pi`" — turned out to be wrong on this user's setup (the running Electron process shows `/proc/<pid>/environ` PATH including `~/.nvm/.../bin` and `~/.local/bin`). The actual root cause is a four-bug cascade where each upstream probe is silently dead-by-design and the final fallback's self-heal trips on stale symlinks.

Constraints:
- Cross-platform: Linux / macOS / Windows must all keep working. No Windows-specific branches beyond what `binary-lookup.ts` already does. Each fix uses only Node built-ins (`path`, `fs`) or the existing shared `pi-package-resolver` (already Windows-safe — its existing tests cover Windows path arithmetic).
- Pure refactor / addition / deletion of fail-closed code paths. No new dependencies. No persisted state changes.
- Tests today live in `packages/<pkg>/src/__tests__/` (the `src/`-relative convention), not bare `<pkg>/__tests__/`. Lift the read-only verification harness scripts at `/tmp/pi-dash-verify/` into deterministic real-fs tmp-dir tests so they survive reboots.

Stakeholders: every Electron user, especially:
- power-user-mode installs where `installStandalone` was never invoked to put pi-coding-agent into `~/.pi-dashboard/node_modules/`
- users whose managed dir is corrupted (partial extract, AV quarantine, npm bin-shim leftovers from a prior version)
- npm-global users whose `pi-dashboard` install has jiti only under `pi-coding-agent/node_modules/jiti` (not at the wrapper-tree top level)

## Goals / Non-Goals

**Goals:**

- `probePiExtension` succeeds on every machine that has a working pi install registered in `~/.pi/agent/settings.json#packages[]`, using the same shared resolver plugin bridges already rely on.
- `probeNpmGlobal` succeeds on every machine that has `pi-dashboard` on PATH AND a working jiti reachable via the standard `ToolResolver.resolveJiti` chain (managed pi → system pi → caller anchor → argv[1]).
- Every silent diagnostic emitted by `buildExtractedSource` (extracted source unhealthy / extract failure / stash failure / install failure / merge failure) lands in a file users and developers can read after a failed cold launch.
- The extracted self-heal block recovers from any prior managed-dir state, including ones with stale absolute symlinks that point back into `<resourcesPath>/server/`. The selective-wipe step actually wipes; `cpSync` writes onto a clean destination.
- `pi-dashboard --version` always answers truthfully — including on installs where jiti is missing or broken — by reading sibling `package.json`. Other subcommands still fail loud if jiti is absent.
- No regression for any currently-working code path. The chain `attach → devMonorepo` is untouched. The bundle-extraction logic, stash+install+merge sequence, and `extractedSourceIsHealthy` health check all preserve their existing contracts.

**Non-Goals:**

- Investigating WHY in production the previous shape of `buildExtractedSource` resulted in the 89 ms cold-launch FATAL (we now know — it's the stale-symlink EINVAL that's caught silently). That hand-off note is the trigger for this change, not a separate follow-up.
- Login-shell PATH fallback in launch-source probes. Verified unnecessary on the maintainer's box; may be revisited if QA reveals Linux distros where systemd-spawned Electron processes really do lose `~/.local/bin`. The `whichViaLoginShell` helper already exists in `binary-lookup.ts` so a future change is trivial.
- Restoring tsx fallback in `pi-dashboard.mjs` (removed by `replace-tsx-with-jiti`). Jiti-only stays.
- Replacing the V2 LaunchSource resolver with the `windows-integration-v2` branch's `ts-loader-resolver.ts` approach. That branch is stale (still uses `@mariozechner/*` namespace) and represents a parallel design that was superseded by `simplify-electron-bootstrap-derived-state`.
- Reading `settings.extensions` for back-compat. The field never existed in pi's actual schema; reading it is dead code, not back-compat.

## Decisions

### D1 — `probePiExtension` iterates `settings.packages[]` via the shared resolver

`packages/shared/src/pi-package-resolver.ts` (added by `add-shared-pi-package-resolver`) already walks `~/.pi/agent/settings.json#packages[]` and per-cwd settings; classifies each entry (`npm:` / `git:` / `https://` / abs / rel); maps to install dir via the same path arithmetic pi-coding-agent uses internally. Its existing test suite (22 cases) covers cross-platform path edge cases. Add a new `listPiPackages(opts): ResolvedPiPackage[]` export that returns every package without a name filter; refactor existing `findInScope` to share an `iterateInScope` generator. `probePiExtension` consumes `listPiPackages` via an injectable probe (defaulting to `listPiPackages({ scope: "user" })`); tests inject stubs returning fake `ResolvedPiPackage` arrays for hermetic coverage.

**Alternatives considered:**
- Re-parse `settings.json#packages[]` inline in `launch-source.ts`. Rejected: duplicates non-trivial logic (npm/git/abs/rel parsing; pi cache directory arithmetic).
- Read both `settings.extensions` AND `settings.packages` for back-compat. Rejected: `settings.extensions` does not exist in pi's current schema and never has at the version pi-dashboard depends on.

### D2 — `pi-dashboard --version` short-circuits before jiti resolution

Top of `pi-dashboard.mjs`: check `process.argv[2]` against `--version` / `-v` / `version`. If matched, read sibling `package.json` via `readFileSync` + `JSON.parse`, print `pkg.version` to stdout, exit 0. Wrap in try/catch so a corrupt sibling pkg.json falls through to the existing jiti-resolve path (preserving the legacy install-hint error for genuinely broken installs).

**Alternatives considered:**
- Hard-coded version constant. Rejected: stale across version bumps.
- Use `--input-type=module` to keep argv parsing inside `cli.ts`. Rejected: `cli.ts` is TypeScript, requires jiti to load — defeats the goal.
- Add a CLI argument parser library. Rejected: 5-line short-circuit is sufficient, dependency-free.

### D3 — Dual-write launch-source diagnostics to `~/.pi/dashboard/server.log`

Add helpers `appendDashboardLog(message, logFile?)` and `logLaunchSource(level, message, logFile?)` in `launch-source.ts`. `appendDashboardLog` opens the dashboard log file in append mode (mirroring `launchDashboardServer`'s header-line pattern), writes one `[<ISO-ts>] [launch-source] ...` line, closes. `logLaunchSource` writes BOTH stderr (`console.warn` / `console.error` — kept for dev-mode visibility under `electron-forge start`) AND the log file. Strip the `[launch-source]` prefix when forwarding to the file helper so the file's own prefix doesn't double-stamp. Export both via a `_testing` namespace so tests can assert without globbing `console`. Replace all 8 `console.warn` / `console.error` sites in `launch-source.ts` with `logLaunchSource(...)` calls.

**Alternatives considered:**
- Plumb the main-process `log()` callback into `selectLaunchSource` via options. Rejected: increases signature surface; the natural destination (`~/.pi/dashboard/server.log`) is the file every other dashboard component already writes to.
- Replace stderr with the log file. Rejected: dev mode would lose the live visibility it currently has via `electron-forge start`.
- Use a structured logger (pino / winston). Rejected: scope creep; existing append-fd pattern works on every OS.

### D4 — `extractFs` shape: drop the no-op overrides for destructive operations

In `buildExtractedSource`, the current `extractFs` is typed as `ExtractFs` (full) with `mkdirSync` / `readdirSync` / `rmSync` / `statSync` all set to no-ops, on the comment-claimed assumption that "real fs handles them by default via extractBundle". The overrides actually win at runtime (they're spelled out fields in the object literal; `buildFs` does `partial?.mkdirSync ?? real`, with the partial wining). This breaks the selective-wipe step in `extractBundle`: `readdirSync(managedDir)` returns `[]`, the wipe loop is a no-op, stale absolute symlinks remain on disk, `cpSync` follows them back into source, EINVAL fires inside the try/catch. The whole block returns `didExtract: false`, `installStandalone` is never called, jiti never installed, spawn fails with `JitiNotFoundError`.

Fix: change `extractFs` type from `ExtractFs` to `Partial<ExtractFs>`, and pass only the file-content probes the surrounding migrateConfigs / installable-defaults / strip-package-lock blocks actually need (`existsSync`, `readFileSync`, `writeFileSync`, `renameSync`). The destructive operations (`mkdirSync`, `readdirSync`, `rmSync`, `statSync`, `cpSync`) default to real fs via `buildFs`. The selective-wipe step then runs as designed.

**Alternatives considered:**
- Keep the no-op overrides but pass real `readdirSync` + `rmSync`. Rejected: misleading shape; the comment explicitly says "real fs handles by default" — the code now matches the comment.
- Add a `dereference: false` option to `cpSync`. Rejected: doesn't fix the underlying stale-state problem; only changes how cpSync behaves on its first encounter with a symlink. The root cause is the destination not being wiped before write.
- Pre-clean only `node_modules/.bin/` (where the EINVAL-triggering symlinks tend to be). Rejected: more brittle than running the existing wipe-the-whole-thing step that was already designed for this.

### D5 — Test fixtures lifted from the live verification harness

The `/tmp/pi-dash-verify/` scripts used to root-cause these bugs become deterministic regression tests under each package's `src/__tests__/`:
- `verify.mjs` (probe-only, read-only against fixture settings.json) → unit tests for each probe scenario in `launch-source.test.ts` (3, 3a, 3b, 3c, 9).
- `verify-install.mjs` + `verify-full-flow.mjs` (HOME-override harness) → coverage via the smoke test `launch-source.smoke.test.ts` Tier B (which already runs the full extract+install+merge cycle against a tmp HOME).
- `pi-dashboard --version` short-circuit → `cli-version.test.ts` (6 scenarios covering jiti-present, jiti-missing, corrupt pkg.json, `start` preserves jiti-miss exit-1, `-v` shortform, missing sibling pkg.json).
- Bug D EINVAL reproduction → `launch-source-extract-stale-symlink.test.ts`: pre-populate destination with `<managedDir>/node_modules/foo/node_modules/.bin/X` symlinked to `<bundleSource>/.../X`, assert `extractBundle` succeeds without EINVAL and produces a clean destination.

All tests use real-fs tmp dirs (same pattern as `pi-package-resolver.test.ts`). No mocking of `fs`. Determinism from controlled fixture state.

## Risks / Trade-offs

- **Risk**: `probePiExtension` succeeds for a `packages[]` entry whose `pi --version` reports a version `>= bundledMinVersion` but whose `pi-dashboard-server` resolves to an incompatible version → spawn fails at the second version-gate. **Mitigation**: existing two-pass version check (server-package + pi) is preserved; only the iteration source changes.
- **Risk**: `pi-dashboard --version` exits 0 with stale version on a corrupt install where `package.json` is truncated. **Mitigation**: try/catch falls through to the existing jiti-resolve path on parse failure — same legacy install-hint error fires when the install is genuinely broken.
- **Risk**: Logging to `~/.pi/dashboard/server.log` interleaves pre-spawn launch-source diagnostics with post-spawn server logs. **Mitigation**: every line carries `[launch-source]` prefix matching existing operator-grep conventions (`[bootstrap]`, `[plugin-loader]`, etc.).
- **Risk**: Removing the no-op overrides changes the order of destructive operations in `extractBundle` for any test that was implicitly relying on the no-op behaviour. **Mitigation**: existing `launch-source.test.ts` mocks `extractBundle` via `vi.spyOn(bundleExtract, "extractBundle").mockImplementation(() => {})` for test isolation — the no-op stubs in `extractFs` were never load-bearing for any test (they were a production-only bug). The smoke test Tier B exercises the real `extractBundle` and passes today (with my user's `fix-stale-electron-test-mocks` change merged); will continue to pass.
- **Trade-off**: The legacy `extensions[].path` field-reading is removed entirely with no migration shim. Acceptable because the field never existed in pi's real schema — no real user data relies on it.
- **Cross-platform**: every fix uses only Node built-ins (`path`, `fs`, `os`). `path.isAbsolute` / `path.resolve` handle Windows drive letters. `pi-package-resolver` itself is fully cross-platform (existing 22 tests cover Windows path arithmetic). `appendDashboardLog`'s `mkdirSync` + `openSync` + `writeSync` + `closeSync` work identically on Linux / macOS / Windows.
- **Rollback**: revert three source files (`launch-source.ts`, `pi-dashboard.mjs`, `pi-package-resolver.ts`). No persisted state changes. Tests revert with them.
