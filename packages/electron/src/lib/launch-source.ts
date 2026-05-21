/**
 * launch-source.ts — LaunchSource V2 resolver for the Electron main process.
 *
 * Resolves which server binary / source tree to use, in priority order:
 *   1. attach      — a compatible server is already running; just attach.
 *   2. devMonorepo — running from the checked-out monorepo (dev workflow).
 *   3. piExtension — the pi bridge extension packages a server.
 *   4. npmGlobal   — `pi-dashboard` is installed globally via npm.
 *   5. extracted   — bundled Electron resources (managed install); always succeeds.
 *
 * All I/O probes are injectable so unit tests never touch the real filesystem,
 * network, or child-process layer.
 *
 * Gated behind `isLaunchSourceV2Enabled(process.env)` in main.ts (Phase A).
 * See openspec/changes/simplify-electron-bootstrap-derived-state.
 */

import path from "node:path";
import os from "node:os";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { launchDashboardServer } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { listPiPackages, type ResolvedPiPackage } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import { installStandalone } from "./dependency-installer.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getBundledNodePath } from "./bundled-node.js";
import { detectSystemNode } from "./dependency-detector.js";
import { pickNodeForServer } from "./pick-node.js";
import type { LaunchSource, SourceKind } from "@blackbelt-technology/pi-dashboard-shared/launch-source-types.js";
import type { DashboardStarter } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";

export type { LaunchSource, SourceKind };

// ── Constants ────────────────────────────────────────────────────────────────

export const VALID_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "attach",
  "devMonorepo",
  "piExtension",
  "npmGlobal",
  "extracted",
]);

// ── Error types ───────────────────────────────────────────────────────────────

export class PinnedSourceUnavailableError extends Error {
  constructor(public readonly sourceKind: SourceKind) {
    super(
      `Pinned source "${sourceKind}" is not available. ` +
        `Check DASHBOARD_PREFER_SOURCE or remove the override.`,
    );
    this.name = "PinnedSourceUnavailableError";
  }
}

// ── Env parsing ───────────────────────────────────────────────────────────────

/**
 * Parse `DASHBOARD_PREFER_SOURCE` env var.
 * Returns a `SourceKind` or `null` when unset, empty, or invalid.
 * Logs a warning on invalid value.
 */
export function parsePreferOverride(
  env: Record<string, string | undefined>,
): SourceKind | null {
  const raw = env["DASHBOARD_PREFER_SOURCE"];
  if (!raw) return null;
  if (VALID_SOURCE_KINDS.has(raw as SourceKind)) return raw as SourceKind;
  logLaunchSource(
    "warn",
    `[launch-source] Unknown DASHBOARD_PREFER_SOURCE value "${raw}"; ignoring override.`,
  );
  return null;
}

// ── Probe interfaces ──────────────────────────────────────────────────────────

export interface HealthProbeResult {
  running: boolean;
  starter?: DashboardStarter;
  url?: string;
}

export interface LaunchSourceProbes {
  healthProbe(port: number): Promise<HealthProbeResult>;
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: "utf-8"): string;
  writeFileSync(p: string, data: string): void;
  renameSync(src: string, dst: string): void;
  which(cmd: string): Promise<string | null>;
  /** Run `cmd --version` and return the version string, or null on timeout/error. */
  spawnVersion(cmd: string, timeoutMs: number): Promise<string | null>;
  realpathSync(p: string): string;
  requireResolve(id: string, options?: { paths: string[] }): string;
  /**
   * List every resolved pi package across user + project scopes. Used by
   * `probePiExtension` to iterate the actual `settings.packages[]` schema
   * (replaces the previous hand-rolled `parsePiSettings` that read the
   * non-existent `settings.extensions[]` field). Default implementation
   * delegates to the shared `pi-package-resolver`. Tests inject a stub
   * returning fake packages, hermetic without touching real `~/.pi`.
   *
   * Added by change: fix-electron-cold-launch-probe-cascade (Bug A).
   */
  listPiPackages(): ResolvedPiPackage[];
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface LaunchSourceOpts {
  isPackaged: boolean;
  cwd: string;
  preferOverride: SourceKind | null;
  bundledMinVersion: string;
  resourcesPath: string;
  port?: number;
  /** ~/.pi/dashboard config dir (defaults to os.homedir()/.pi/dashboard). */
  dashboardConfigDir?: string;
  probes?: Partial<LaunchSourceProbes>;
}

// ── Default probe implementations ─────────────────────────────────────────────

import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync, realpathSync as fsRealpathSync, renameSync as fsRenameSync, mkdirSync as fsMkdirSync, openSync as fsOpenSync, writeSync as fsWriteSync, closeSync as fsCloseSync } from "node:fs";
import { needsExtraction, extractBundle } from "./bundle-extract.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process"; // ban:child_process-ok default probe impls only; injectable in tests

const _require = createRequire(import.meta.url);

function defaultHealthProbe(port: number): Promise<HealthProbeResult> {
  return fetch(`http://localhost:${port}/api/health`, {
    signal: AbortSignal.timeout(3000),
  })
    .then(async (res) => {
      if (!res.ok) return { running: false };
      const data = (await res.json()) as Record<string, unknown>;
      if (!data || data.ok !== true || typeof data.pid !== "number") {
        return { running: false };
      }
      const starter = data.starter as DashboardStarter | undefined;
      const url = `http://localhost:${port}`;
      return { running: true, starter, url };
    })
    .catch(() => ({ running: false }));
}

function defaultWhich(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === "win32" ? "where" : "which"; // platform-branch-ok default probe
    execFile(whichCmd, [cmd], { encoding: "utf-8" }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout.trim().split(/\r?\n/)[0]?.trim();
      resolve(line || null);
    });
  });
}

function defaultSpawnVersion(cmd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    const child = execFile(cmd, ["--version"], { encoding: "utf-8" }, (err, stdout) => {
      clearTimeout(timer);
      if (err) return resolve(null);
      const line = stdout.trim().split(/\r?\n/)[0]?.trim() ?? null;
      resolve(line || null);
    });
  });
}

function defaultRequireResolve(id: string, options?: { paths: string[] }): string {
  return _require.resolve(id, options);
}

// ── Diagnostic logging ───────────────────────────────────────────────────

/**
 * Append a single `[<ISO-ts>] [launch-source] ...` line to the dashboard
 * log file (`~/.pi/dashboard/server.log`). Mirrors the header-line pattern
 * used by `launchDashboardServer` so all launch-related diagnostics land
 * in one place.
 *
 * Why: packaged-Electron `.desktop` launches discard stderr. Every silent
 * probe failure (extracted source unhealthy, bundle extraction failed,
 * runtime baseline install failed, ...) was previously invisible to users
 * AND developers. This helper persists them.
 *
 * Best-effort: if mkdir/open/write fails, swallow — log-routing must
 * never crash the launch.
 *
 * Added by change: fix-electron-cold-launch-probe-cascade (Bug C).
 */
function appendDashboardLog(message: string, logFile?: string): void {
  try {
    const file =
      logFile ?? path.join(os.homedir(), ".pi", "dashboard", "server.log");
    fsMkdirSync(path.dirname(file), { recursive: true });
    const fd = fsOpenSync(file, "a");
    try {
      const line = `[${new Date().toISOString()}] [launch-source] ${message}\n`;
      fsWriteSync(fd, line);
    } finally {
      fsCloseSync(fd);
    }
  } catch {
    /* swallow — logging must never crash the launch */
  }
}

/**
 * Emit a diagnostic to BOTH stderr (dev-mode visibility via
 * `electron-forge start`) AND the dashboard log file (production
 * `.desktop` visibility).
 */
function logLaunchSource(level: "warn" | "error", message: string, logFile?: string): void {
  if (level === "error") console.error(message);
  else console.warn(message);
  const body = message.startsWith("[launch-source] ")
    ? message.slice("[launch-source] ".length)
    : message;
  appendDashboardLog(body, logFile);
}

// Re-exported for tests so they can assert log-file content without
// touching the real `~/.pi/dashboard/server.log`.
export const _testing = { appendDashboardLog, logLaunchSource };

function defaultListPiPackages(): ResolvedPiPackage[] {
  // Default to user scope only — launch-source has no concept of a per-cwd
  // pi project (Electron launches from `$HOME`, not from a code repo).
  // Tests inject their own stub.
  return listPiPackages({ scope: "user" });
}

function buildProbes(partial?: Partial<LaunchSourceProbes>): LaunchSourceProbes {
  return {
    healthProbe: partial?.healthProbe ?? defaultHealthProbe,
    existsSync: partial?.existsSync ?? fsExistsSync,
    readFileSync: partial?.readFileSync ?? ((p, enc) => fsReadFileSync(p, enc)),
    writeFileSync: partial?.writeFileSync ?? ((p, data) => fsWriteFileSync(p, data)),
    renameSync: partial?.renameSync ?? fsRenameSync,
    which: partial?.which ?? defaultWhich,
    spawnVersion: partial?.spawnVersion ?? defaultSpawnVersion,
    realpathSync: partial?.realpathSync ?? fsRealpathSync,
    requireResolve: partial?.requireResolve ?? defaultRequireResolve,
    listPiPackages: partial?.listPiPackages ?? defaultListPiPackages,
  };
}

// ── Version comparison (inline, no semver dep) ────────────────────────────────

function parseVersionTriplet(v: string): [number, number, number] | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function versionGte(version: string, minimum: string): boolean {
  const a = parseVersionTriplet(version);
  const b = parseVersionTriplet(minimum);
  if (!a || !b) return true; // can't parse → be permissive
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

// ── Per-source probe helpers ──────────────────────────────────────────────────

function probeDevMonorepo(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): LaunchSource | null {
  if (opts.isPackaged) return null;
  const serverCli = path.join(opts.cwd, "packages", "server", "src", "cli.ts");
  const bridgeTs = path.join(opts.cwd, "packages", "extension", "src", "bridge.ts");
  if (probes.existsSync(serverCli) && probes.existsSync(bridgeTs)) {
    return { kind: "devMonorepo", cliPath: serverCli, cwd: opts.cwd };
  }
  return null;
}

async function probePiExtension(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  // Iterate every pi package registered in `~/.pi/agent/settings.json#packages[]`
  // via the shared resolver. Replaces the previous hand-rolled parse of
  // `settings.extensions[].path` — a field that does not exist in pi's
  // current schema and never produced a probe hit in production.
  // See change: fix-electron-cold-launch-probe-cascade (Bug A).
  let resolved: ResolvedPiPackage[];
  try {
    resolved = probes.listPiPackages();
  } catch {
    return null;
  }
  if (resolved.length === 0) return null;

  for (const pkg of resolved) {
    const extDir = pkg.packageDir;
    const bridgeTs = path.join(extDir, "bridge.ts");
    const srcBridgeTs = path.join(extDir, "src", "bridge.ts");
    if (!probes.existsSync(bridgeTs) && !probes.existsSync(srcBridgeTs)) continue;

    let serverPkgPath: string;
    try {
      serverPkgPath = probes.requireResolve(
        "@blackbelt-technology/pi-dashboard-server/package.json",
        {
          paths: [
            extDir,
            path.join(extDir, ".."),
            path.join(extDir, "node_modules"),
          ],
        },
      );
    } catch {
      continue;
    }

    let serverVersion: string | undefined;
    try {
      const pkgJson = JSON.parse(
        probes.readFileSync(serverPkgPath, "utf-8"),
      ) as { version?: string };
      serverVersion = pkgJson.version;
    } catch {
      continue;
    }
    if (!serverVersion || !versionGte(serverVersion, opts.bundledMinVersion)) continue;

    const piVersion = await probes.spawnVersion("pi", 3000);
    if (!piVersion || !versionGte(piVersion, opts.bundledMinVersion)) continue;

    const serverPkgDir = path.dirname(serverPkgPath);
    const cliPath = path.join(serverPkgDir, "src", "cli.ts");
    return { kind: "piExtension", cliPath, cwd: extDir };
  }

  return null;
}

async function probeNpmGlobal(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  const whichResult = await probes.which("pi-dashboard");
  if (!whichResult) return null;

  // Must not be under resourcesPath (would mean it's our own bundled binary).
  let realWhich: string;
  try {
    realWhich = probes.realpathSync(whichResult);
  } catch {
    return null;
  }
  const normalResources = opts.resourcesPath.replace(/\\/g, "/");
  const normalReal = realWhich.replace(/\\/g, "/");
  if (normalReal.startsWith(normalResources)) return null;

  // Version check.
  const versionOutput = await probes.spawnVersion(whichResult, 3000);
  if (!versionOutput) return null;
  if (!versionGte(versionOutput, opts.bundledMinVersion)) return null;

  // Resolve server cli.ts from the npm-global install.
  let serverPkgPath: string;
  try {
    serverPkgPath = probes.requireResolve(
      "@blackbelt-technology/pi-dashboard-server/package.json",
      { paths: [path.dirname(whichResult)] },
    );
  } catch {
    return null;
  }

  const cliPath = path.join(path.dirname(serverPkgPath), "src", "cli.ts");
  return { kind: "npmGlobal", cliPath, cwd: path.dirname(whichResult) };
}

/**
 * Pure helper: returns true iff the extracted managed dir is usable to spawn
 * the dashboard server. "Usable" means cliPath exists on disk AND jiti is
 * resolvable via createRequire walking up from cliPath.
 *
 * The version marker alone is insufficient because it can be stale relative
 * to the actual node_modules tree (partial extraction, AV quarantine, manual
 * wipe, npm reconciliation prune). When this returns false the caller MUST
 * force re-extract + installStandalone.
 *
 * Defensive: any thrown error from the injected probes is treated as
 * unhealthy. Pure when both deps are injected.
 *
 * See change: fix-electron-extracted-jiti-and-stdio-capture.
 */
export function extractedSourceIsHealthy(
  cliPath: string,
  deps?: {
    existsSync?: (p: string) => boolean;
    /** Anchor-only jiti probe; returns a `file://` URL or null. */
    resolveJiti?: (anchor: string) => string | null;
  },
): boolean {
  const exists = deps?.existsSync ?? fsExistsSync;
  const resolveJiti =
    deps?.resolveJiti ??
    ((anchor: string) => new ToolResolver().resolveJiti({ anchor, anchorOnly: true }));
  try {
    if (!exists(cliPath)) return false;
    const url = resolveJiti(cliPath);
    return typeof url === "string" && url.length > 0;
  } catch {
    return false;
  }
}

async function buildExtractedSource(
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource> {
  const managedDir = path.join(os.homedir(), ".pi-dashboard");
  const cliPath = path.join(
    managedDir,
    "node_modules",
    "@blackbelt-technology",
    "pi-dashboard-server",
    "src",
    "cli.ts",
  );

  // Check if extraction is needed and run it.
  const currentVersion = opts.bundledMinVersion;
  //
  // Pass only the file-content probes (existsSync/readFileSync/writeFileSync/
  // renameSync) that tests inject; let `buildFs` inside `extractBundle` fill
  // in the destructive operations (mkdirSync/readdirSync/rmSync/statSync/
  // cpSync) with real-fs defaults.
  //
  // Bug D fix (see change: fix-electron-cold-launch-probe-cascade): the
  // previous shape passed no-op overrides for the destructive ops which
  // silently broke `extractBundle`'s selective-wipe step. With wipe a
  // no-op, stale absolute symlinks left under `~/.pi-dashboard/node_modules`
  // by a previous partial extract were not deleted before `cpSync`. The
  // bundle's relative `.bin/*` symlinks then ran through those stale
  // pointers back into `<resourcesPath>/server/`, producing
  // `ERR_FS_CP_EINVAL: cannot copy <bundle-path> to a subdirectory of
  // self <same-bundle-path>`. The extracted source path then bailed with
  // `didExtract:false`, `installStandalone` never ran, and the spawn
  // step failed with `JitiNotFoundError`.
  //
  // Real readdirSync + rmSync now actually delete `node_modules/` (and any
  // other non-SURVIVE entries) before `cpSync`, so the destination is
  // clean. Self-healing for users whose managed dir is already corrupt
  // — no local cleanup required.
  const extractFs: Partial<import("./bundle-extract.js").ExtractFs> = {
    existsSync: probes.existsSync,
    readFileSync: probes.readFileSync,
    writeFileSync: probes.writeFileSync,
    renameSync: probes.renameSync,
  };

  const markerSaysExtract = needsExtraction(managedDir, currentVersion, extractFs);
  // Health-check the extracted tree even when the marker matches: marker can
  // be stale relative to actual node_modules contents (partial extraction,
  // AV quarantine, manual wipe, npm prune). When unhealthy we force the
  // extract+install block to run.
  // See change: fix-electron-extracted-jiti-and-stdio-capture.
  const healthy = markerSaysExtract
    ? false  // about to extract anyway
    : extractedSourceIsHealthy(cliPath, {
        existsSync: probes.existsSync,
        resolveJiti: (anchor) => new ToolResolver().resolveJiti({ anchor, anchorOnly: true }),
      });
  if (!markerSaysExtract && !healthy) {
    logLaunchSource(
      "warn",
      "[launch-source] extracted source unhealthy (jiti missing); forcing re-extract",
    );
  }
  const didExtract = markerSaysExtract || !healthy;
  if (didExtract) {
    const configDir = opts.dashboardConfigDir ?? path.join(os.homedir(), ".pi", "dashboard");
    const migrateDir = path.join(
      configDir,
      "migrate",
      new Date().toISOString().replace(/:/g, "-"),
    );
    try {
      // Bundle source is `<resourcesPath>/server/` — the layout produced by
      // `bundle-server.mjs` (synthetic package.json + packages/ + node_modules/).
      // Top-level `resourcesPath` cannot be the source: it contains app.asar
      // (a file), so cpSync recurses and trips ENOTDIR on opendir(app.asar).
      // The cliPath constructed above resolves only when `<server>/node_modules/
      // @blackbelt-technology/pi-dashboard-server/src/cli.ts` lands at
      // `<managedDir>/node_modules/...`, which is exactly what cpSync of
      // `<resourcesPath>/server/` produces.
      const bundleSource = path.join(opts.resourcesPath, "server");
      // Pass extractFs so tests can inject the existsSync/writeFileSync behaviour.
      // Real fs handles mkdirSync/readdirSync/rmSync/cpSync by default.
      extractBundle(managedDir, bundleSource, currentVersion, migrateDir, extractFs);

      // Seed installable.json (idempotent — only when absent).
      const installableTarget = path.join(configDir, "installable.json");
      if (!probes.existsSync(installableTarget)) {
        const bundledDefaults = path.join(opts.resourcesPath, "installable-defaults.json");
        if (probes.existsSync(bundledDefaults)) {
          const content = probes.readFileSync(bundledDefaults, "utf-8");
          const tmp = installableTarget + ".tmp";
          probes.writeFileSync(tmp, content);
          probes.renameSync(tmp, installableTarget);
        }
      }

      // Detach the bundle's build-time package.json + package-lock.json BEFORE
      // running installStandalone. `bundle-server.mjs` writes a synthetic
      // workspace package (workspaces: ["packages/server", "packages/shared",
      // "packages/extension"]) and the matching package-lock so the Docker
      // build-time `npm install` (in resources/server/) sets up workspace
      // symlinks for native module resolution. At runtime both files are
      // actively harmful: `npm install --prefix <managedDir>` (called by
      // installStandalone) reconciles node_modules against the lockfile and
      // wipes the pre-extracted `@blackbelt-technology/*` entries we just
      // copied in (since their lockfile records say "workspace link" but the
      // stripped package.json no longer declares workspaces) — destroying
      // cliPath and breaking the spawn.
      //
      // Resolution: nuke both files. ensureManagedDir() will recreate a
      // minimal package.json on its first call; npm install with explicit
      // packages (no lockfile) only ADDS the requested deps and does not
      // prune unrelated node_modules entries.
      //
      // Smoke test `launch-source.smoke.test.ts` Tier B caught this.
      // See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
      try {
        const fsMod = await import("node:fs");
        const pkgPath = path.join(managedDir, "package.json");
        const lockPath = path.join(managedDir, "package-lock.json");
        // package.json: keep file, but strip workspaces if present (defensive
        // in case ensureManagedDir's existsSync check no-ops the rewrite).
        if (fsMod.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fsMod.readFileSync(pkgPath, "utf-8"));
            if (pkg.workspaces !== undefined) {
              delete pkg.workspaces;
              fsMod.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
            }
          } catch { /* malformed JSON — ensureManagedDir will overwrite */ }
        }
        // package-lock.json: nuke. The bundle's lockfile is build-time only.
        if (fsMod.existsSync(lockPath)) {
          fsMod.rmSync(lockPath, { force: true });
        }
      } catch (stripErr: any) {
        logLaunchSource(
          "error",
          `[launch-source] could not normalize managedDir before install: ${stripErr?.message ?? String(stripErr)}`,
        );
      }

      // Install runtime baseline (pi-coding-agent + tsx + openspec) into
      // managedDir from the bundled offline cacache. Without this, the
      // spawned server cannot resolve jiti to load TypeScript source files
      // — `bundle-server.mjs` deliberately omits pi from the bundle (see its
      // comment block) and relies on this offline-cache install instead.
      // The legacy path (LAUNCH_SOURCE_V2=false) does the equivalent via
      // `runPowerUserManagedInstall`. Idempotent: gated by `didExtract`,
      // and `installStandalone` itself short-circuits already-installed
      // packages.
      // See change: simplify-electron-bootstrap-derived-state (Phase C
      // bring-up — spec gap: server-side `bootstrap-install-from-list`
      // cannot install jiti because the server needs jiti to start).
      // Swap-aside pattern: protect bundle's node_modules from npm's
      // reconciliation. The synthetic package.json bundle-server.mjs
      // writes declares no dependencies, so `npm install --prefix
      // <managedDir> @earendil-works/pi-coding-agent ...` treats every
      // existing entry under node_modules/ as "extraneous" and prunes it.
      // That destroys not just @blackbelt-technology/* (cliPath) but
      // every server runtime dep (fastify, ws, lru-cache, etc.).
      //
      // Move the bundle's node_modules aside, let npm install build a
      // fresh tree containing only pi/tsx/openspec + their deps, then
      // overlay the bundle snapshot back on top — bundle wins on conflicts
      // (it's the version the server was built and tested against;
      // pi-coding-agent's namespace is mostly @mariozechner/* which the
      // bundle never had, so the merge is mostly additive).
      //
      // Smoke test `launch-source.smoke.test.ts` Tier B/C caught both
      // pruning regressions.
      const fsMod = await import("node:fs");
      const managedNm = path.join(managedDir, "node_modules");
      const stashedNm = path.join(managedDir, ".bundle-node-modules");
      let stashed = false;
      try {
        if (fsMod.existsSync(managedNm)) {
          // rmSync first in case a previous interrupted run left a stash.
          fsMod.rmSync(stashedNm, { recursive: true, force: true });
          fsMod.renameSync(managedNm, stashedNm);
          stashed = true;
        }
      } catch (stashErr: any) {
        logLaunchSource(
          "error",
          `[launch-source] could not stash bundle node_modules: ${stashErr?.message ?? String(stashErr)}`,
        );
      }

      try {
        await installStandalone();
      } catch (installErr: any) {
        logLaunchSource(
          "error",
          `[launch-source] runtime baseline install failed: ${installErr?.message ?? String(installErr)}`,
        );
      }

      // Merge the stashed bundle tree back on top. cpSync with default
      // force:true overwrites files where bundle and npm both wrote;
      // bundle versions win (deliberate — the server was tested against
      // them). Directories are merged additively.
      if (stashed) {
        try {
          fsMod.cpSync(stashedNm, managedNm, { recursive: true });
          fsMod.rmSync(stashedNm, { recursive: true, force: true });
        } catch (mergeErr: any) {
          logLaunchSource(
            "error",
            `[launch-source] could not merge bundle node_modules back: ${mergeErr?.message ?? String(mergeErr)}`,
          );
        }
      }
    } catch (err: any) {
      logLaunchSource(
        "error",
        `[launch-source] bundle extraction failed: code=${err?.code ?? "unknown"} syscall=${err?.syscall ?? "unknown"} path=${err?.path ?? "unknown"} message=${err?.message ?? String(err)}`,
      );
      // Return source anyway — server may still start if a prior extraction exists.
      return { kind: "extracted", cliPath, cwd: managedDir, didExtract: false };
    }
  }

  return { kind: "extracted", cliPath, cwd: managedDir, didExtract };
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the best available `LaunchSource` for this Electron session.
 *
 * Returns `{ kind: "attach", ... }` when a running server is detected.
 * Otherwise probes sources in priority order and returns the first match.
 * The `extracted` source always succeeds (last resort).
 */
export async function selectLaunchSource(opts: LaunchSourceOpts): Promise<LaunchSource> {
  const probes = buildProbes(opts.probes);
  const port = opts.port ?? 8000;

  // 1. Health probe — already running?
  const health = await probes.healthProbe(port);
  if (health.running && health.url) {
    return {
      kind: "attach",
      url: health.url,
      starter: health.starter ?? "Standalone",
    };
  }

  // 2. Override pin?
  if (opts.preferOverride) {
    const pinned = await trySource(opts.preferOverride, opts, probes);
    if (!pinned) throw new PinnedSourceUnavailableError(opts.preferOverride);
    return pinned;
  }

  // 3. Walk the priority chain.
  const chain: SourceKind[] = ["devMonorepo", "piExtension", "npmGlobal", "extracted"];
  for (const kind of chain) {
    const source = await trySource(kind, opts, probes);
    if (source) return source;
  }

  // Should never reach here — extracted always returns a result.
  return buildExtractedSource(opts, probes);
}

async function trySource(
  kind: SourceKind,
  opts: LaunchSourceOpts,
  probes: LaunchSourceProbes,
): Promise<LaunchSource | null> {
  switch (kind) {
    case "attach":
      return null; // handled separately
    case "devMonorepo":
      return probeDevMonorepo(opts, probes);
    case "piExtension":
      return probePiExtension(opts, probes);
    case "npmGlobal":
      return probeNpmGlobal(opts, probes);
    case "extracted":
      return buildExtractedSource(opts, probes);
  }
}

// ── Spawn primitive ───────────────────────────────────────────────────────────

export interface SpawnResult {
  pid: number;
}

/**
 * Spawn the dashboard server from the given `source`.
 * Delegates to the shared `launchDashboardServer` primitive. Owns:
 *   - DASHBOARD_STARTER=Electron stamp
 *   - jiti anchor = source.cliPath (packaged Electron has empty
 *     process.argv[1]; cliPath sits in a real node_modules tree)
 *   - log file at ~/.pi/dashboard/server.log (caller no longer pre-opens
 *     a fd — launcher owns the open/write/close lifecycle)
 *   - detach: false so the server dies with Electron unless
 *     `decideShutdownOnQuit` keeps it alive
 *   - 15 s readiness timeout (cold extraction + bootstrap can be slow)
 */
export async function spawnFromSource(
  source: Exclude<LaunchSource, { kind: "attach" }>,
  config: { port: number; piPort: number },
  opts?: {
    logFile?: string;
    /** Forwarded to `launchDashboardServer.onChildExit`. See change: harvest-bootstrap-survivor-fixes. */
    onChildExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  },
): Promise<SpawnResult> {
  const logFile = opts?.logFile ?? path.join(os.homedir(), ".pi", "dashboard", "server.log");

  // Select the Node binary — bundled first, system fallback, execPath last resort.
  const bundledNode = getBundledNodePath();
  const bundledNodeDir = bundledNode ? path.dirname(path.dirname(bundledNode)) : null;
  // Probe bundled Node's --version so pickNodeForServer can skip it when in
  // the nodejs/node#58515 affected range. See change: skip-affected-bundled-node.
  let bundledNodeVersion: string | undefined;
  if (bundledNode) {
    try {
      bundledNodeVersion = execFileSync(bundledNode, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
    } catch {
      bundledNodeVersion = undefined;
    }
  }
  const pick = pickNodeForServer({
    bundledNodeDir,
    systemNode: detectSystemNode(),
    processExecPath: process.execPath,
    platform: process.platform,
    bundledNodeVersion,
  });

  const baseEnv = new ToolResolver({ processExecPath: pick.nodeBin }).buildSpawnEnv(process.env);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (typeof v === "string") env[k] = v;
  }
  env["DASHBOARD_STARTER"] = "Electron";

  if (pick.kind === "execpath-fallback") {
    env["ELECTRON_RUN_AS_NODE"] = "1";
    logLaunchSource(
      "warn",
      "[pick-node] No bundled or system Node found — falling back to process.execPath with " +
      "ELECTRON_RUN_AS_NODE=1. Server launch may behave unexpectedly. " +
      `execPath=${pick.nodeBin}`,
    );
  }

  try {
    const result = await launchDashboardServer({
      cliPath: source.cliPath,
      anchor: source.cliPath,
      nodeBin: pick.nodeBin,
      extraArgs: [
        "--port", String(config.port),
        "--pi-port", String(config.piPort),
      ],
      env,
      starter: "Electron",
      stdio: { logFile },
      healthTimeoutMs: 15_000,
      port: config.port,
      detach: false,
      cwd: source.cwd,
      onChildExit: opts?.onChildExit,
    });
    return { pid: result.reportedPid ?? result.childPid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to spawn server from source "${source.kind}": ${message}`);
  }
}
