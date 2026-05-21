/**
 * Server discovery and lifecycle management for Electron.
 * Uses health check → spawn server.
 *
 * NOTE: This module must NOT import from @blackbelt-technology/pi-dashboard-shared
 * or @blackbelt-technology/pi-dashboard-server via dynamic import(). In the packaged
 * Electron app, those packages are inside resources/server/node_modules/ which is NOT
 * on the ESM module resolution path. All config reading and health checking is inlined.
 */
import { spawnDetached, waitForReady } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { execFileSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  launchDashboardServer,
  JitiNotFoundError,
  PortConflictError,
  EarlyExitError,
} from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { readModeFile } from "./wizard-state.js";
import { detectSystemNode, detectPiDashboardCli, detectPi } from "./dependency-detector.js";
import { getBundledNodePath } from "./bundled-node.js";
import { pickNodeForServer } from "./pick-node.js";
import { isDashboardRunning } from "./health-check.js";
import type { DashboardStatus } from "./health-check.js";
import { MANAGED_DIR } from "./managed-paths.js";

/**
 * Pure helper: build the options object passed to spawnDetached for the
 * dashboard-server launch. Extracted for unit testing — keeps the `detach:
 * false` invariant asserted in a pure test without booting Electron.
 *
 * detach: false on Windows keeps the child inside Electron's Job Object, so
 * no new console is allocated (no flash) and the server dies when Electron
 * exits.
 */
export function buildServerSpawnOptions(params: {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  logFd: number | undefined;
}): Parameters<typeof spawnDetached>[0] {
  return {
    cmd: params.cmd,
    args: params.args,
    env: params.env,
    cwd: params.cwd,
    logFd: params.logFd,
    detach: false,
  };
}

let serverStartedByUs = false;

/** PID of the server we spawned in the V2 launch path. Used for ownership check on quit. */
let storedSpawnedPid: number | null = null;

/**
 * Set to `true` immediately before Electron initiates an intentional
 * shutdown (app `before-quit`, programmatic restart). The watchdog inspects
 * this flag to distinguish graceful exits from crashes — a graceful exit
 * MUST NOT trigger the loading-page recovery flow.
 *
 * Reset to `false` after every successful `setSpawnedPid` call so that a
 * programmatic restart (spawn-new-child) re-arms crash detection.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
let gracefulShutdownInProgress = false;

export function setGracefulShutdownInProgress(value: boolean): void {
  gracefulShutdownInProgress = value;
}

export function isGracefulShutdownInProgress(): boolean {
  return gracefulShutdownInProgress;
}

/**
 * Record the PID of the server we spawned (V2 launch path).
 * Called from main.ts after spawnFromSource succeeds. Resets the graceful
 * flag so the watchdog re-arms for the new child.
 */
export function setSpawnedPid(pid: number): void {
  storedSpawnedPid = pid;
  gracefulShutdownInProgress = false;
}

/**
 * Build the watchdog callback passed to `spawnFromSource` (via `onChildExit`)
 * so an unexpected server-child exit routes the user to the loading-page
 * recovery UI.
 *
 * Pure factory — all side-effecting deps are injected so unit tests can
 * verify the graceful-vs-crashed routing decision without booting Electron.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
export function makeServerWatchdog(deps: {
  isGraceful: () => boolean;
  log: (msg: string) => void;
  onCrash: (code: number | null, signal: NodeJS.Signals | null) => void;
}): (code: number | null, signal: NodeJS.Signals | null) => void {
  return (code, signal) => {
    if (deps.isGraceful()) {
      deps.log(
        `[server-lifecycle] server child exited gracefully code=${code} signal=${signal ?? "null"}`,
      );
      return;
    }
    deps.log(
      `[server-lifecycle] server child exited unexpectedly code=${code} signal=${signal ?? "null"} — routing to recovery`,
    );
    try {
      deps.onCrash(code, signal);
    } catch (err) {
      deps.log(
        `[server-lifecycle] crash handler threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
}

/**
 * Pure helper: should Electron stop the server on quit?
 * Rule: only stop when starter is "Electron" AND pid matches what we spawned.
 */
export function decideShutdownOnQuit(params: {
  starter: string | undefined;
  healthPid: number | undefined;
  storedPid: number | null;
}): boolean {
  if (params.storedPid === null) return false;
  return params.starter === "Electron" && params.healthPid === params.storedPid;
}

/** Expected server version — read from bundled server package.json or Electron package.json. */
function getExpectedVersion(): string | null {
  try {
    // Try bundled server package.json
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      const serverPkg = path.join(resourcesPath, "server", "packages", "server", "package.json");
      if (existsSync(serverPkg)) {
        return JSON.parse(readFileSync(serverPkg, "utf-8")).version ?? null;
      }
    }
    // Dev mode: relative to electron package
    const devPkg = path.resolve(__dirname, "..", "..", "..", "server", "package.json");
    if (existsSync(devPkg)) {
      return JSON.parse(readFileSync(devPkg, "utf-8")).version ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

/** Log a warning if the running server version doesn't match what we expect. */
function checkVersionCompatibility(serverVersion: string | undefined): void {
  const expected = getExpectedVersion();
  if (!expected) return; // Can't determine expected version — skip check
  if (!serverVersion) {
    console.warn(`[pi-dashboard] Server does not report a version (expected ${expected}). It may be outdated.`);
    return;
  }
  if (serverVersion !== expected) {
    console.warn(`[pi-dashboard] Server version ${serverVersion} does not match expected version ${expected}.`);
  }
}

/** Did Electron start the server this session? */
export function didWeStartServer(): boolean {
  return serverStartedByUs;
}

/**
 * Server-startup deadline used by both `launchViaCli` and `launchServer`.
 * History: 15s → 60s in `fix-electron-windows-installer-and-server-bootstrap`
 * to give `installStandalone()` + offline-cacache extraction headroom on first
 * launch. Tightened back to 15s in `tighten-electron-server-startup-deadline`
 * because beyond ~15s the failure is almost always terminal (port conflict,
 * missing loader, bad Node) and the interactive loading page (resources/
 * loading.html) is a strictly better surface than a frozen splash — it polls
 * indefinitely and exposes Start server / Doctor / log-tail controls.
 */
export const SERVER_READY_DEADLINE_MS = 15_000;

/**
 * Construct a cause-aware server-startup failure message. Distinguishes
 * "child process exited prematurely" from "deadline elapsed without
 * probe returning true". The pre-fix message conflated both cases under
 * "Server failed to start within 15 seconds (child exited with code N)",
 * which was misleading because the child-exit case never reaches the
 * deadline. Pure helper, exported for tests. See change:
 * fix-electron-windows-installer-and-server-bootstrap (Defect 4 / D4).
 */
export function buildServerStartupError(args: {
  cliPath?: string;
  spawnBin?: string;
  spawnArgs?: string[];
  cwd: string;
  logTail: string;
  readyError: string;
  port?: number;
  piPort?: number;
}): Error {
  const isChildExit = args.readyError.toLowerCase().includes("exit");
  const cmdLine = args.cliPath
    ? `Command: ${args.cliPath} start --port ${args.port ?? "?"} --pi-port ${args.piPort ?? "?"}`
    : `Command: ${args.spawnBin ?? "?"} ${(args.spawnArgs ?? []).join(" ")}`;
  const header = isChildExit
    ? `Server child process exited prematurely (${args.readyError}).\n` +
      `This usually means a missing dependency or wrong TypeScript loader.\n`
    : `Server did not respond within 15 seconds (${args.readyError}).\n` +
      `The server is likely still starting; the loading page will keep polling — try the Doctor button if it doesn't connect.\n`;
  const body =
    `${cmdLine}\n` +
    `CWD: ${args.cwd}\n` +
    (args.logTail ? `\nServer log:\n${args.logTail}` : "\nNo server log available.");
  return new Error(header + body);
}

// ── Inlined config reading (replaces @blackbelt-technology/pi-dashboard-shared/config) ──

interface KnownServerEntry {
  host: string;
  port: number;
  label?: string;
}

interface MinimalConfig {
  port: number;
  piPort: number;
  knownServers: KnownServerEntry[];
}

export function loadMinimalConfig(): MinimalConfig {
  const defaults: MinimalConfig = { port: 8000, piPort: 9999, knownServers: [] };
  try {
    const configFile = path.join(os.homedir(), ".pi", "dashboard", "config.json");
    if (!existsSync(configFile)) return defaults;
    const raw = readFileSync(configFile, "utf-8").trim();
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const knownServers: KnownServerEntry[] = Array.isArray(parsed.knownServers)
      ? parsed.knownServers.filter((s: any) => s && typeof s.host === "string" && typeof s.port === "number")
          .map((s: any) => ({ host: s.host, port: s.port, ...(typeof s.label === "string" ? { label: s.label } : {}) }))
      : [];
    return {
      port: typeof parsed.port === "number" ? parsed.port : defaults.port,
      piPort: typeof parsed.piPort === "number" ? parsed.piPort : defaults.piPort,
      knownServers,
    };
  } catch {
    return defaults;
  }
}

// Health check imported from ./health-check.ts

// ── Server discovery and launch ────────────────────────────────────────────────

/**
 * Discover or launch the dashboard server.
 * Returns the URL to connect to.
 */
export async function ensureServer(): Promise<string> {
  const config = loadMinimalConfig();

  // 1. Health check — is the server already running?
  const status = await isDashboardRunning(config.port);
  if (status.running) {
    checkVersionCompatibility(status.version);
    return `http://localhost:${config.port}`;
  }

  if (status.portConflict) {
    throw new Error(`Port ${config.port} is in use by another service. Change the dashboard port in ~/.pi/dashboard/config.json`);
  }

  // 2. Mode-aware server launch
  const mode = readModeFile();
  const isPowerUser = mode?.mode === "power-user";

  if (isPowerUser) {
    // Power-user: prefer pi-dashboard CLI on PATH → managed → bundled
    const cli = detectPiDashboardCli();
    if (cli.found && cli.path) {
      await launchViaCli(cli.path, config.port, config.piPort);
      serverStartedByUs = true;
      return `http://localhost:${config.port}`;
    }
    // Fall through to tsx + cli.ts resolution
  }

  // Standalone (or power-user fallback): bundled → managed → tsx + cli.ts
  await launchServer(config.port, config.piPort);
  serverStartedByUs = true;
  return `http://localhost:${config.port}`;
}

/** Find the server CLI path. */
function findServerCli(): string | null {
  const candidates = [
    // Bundled with Electron app (resources/server/)
    (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, "server", "packages", "server", "src", "cli.ts")
      : null,
    // Dev mode: relative to electron package
    path.resolve(__dirname, "..", "..", "..", "..", "server", "src", "cli.ts"),
    // Managed install
    path.join(MANAGED_DIR, "node_modules", "@blackbelt-technology", "pi-agent-dashboard", "packages", "server", "src", "cli.ts"),
  ].filter(Boolean) as string[];

  try {
    candidates.push(require.resolve("@blackbelt-technology/pi-dashboard-server/cli.ts"));
  } catch { /* not resolvable */ }

  return candidates.find(p => { try { return existsSync(p); } catch { return false; } }) || null;
}

/**
 * Launch the dashboard server via the pi-dashboard CLI directly.
 * Used in power-user mode when the CLI is on PATH. No tsx resolution needed.
 */
async function launchViaCli(cliPath: string, port: number, piPort: number): Promise<void> {
  const logDir = MANAGED_DIR;
  const logPath = path.join(logDir, "server.log");
  try { mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

  const launchInfo = `[${new Date().toISOString()}] Launching via CLI: ${cliPath} start --port ${port} --pi-port ${piPort}\n`;
  try { writeFileSync(logPath, launchInfo); } catch { /* ignore */ }

  let logFd: number | undefined;
  try {
    logFd = openSync(logPath, "a");
  } catch { /* can't write log, use ignore */ }

  // Build env with the CLI's bin directory on PATH so node/tsx are available
  // (GUI apps on macOS don't inherit shell PATH where nvm/volta live)
  const cliBinDir = path.dirname(cliPath);
  const env = { ...process.env };
  env.PATH = `${cliBinDir}${path.delimiter}${env.PATH || ""}`;

  // Route through buildServerSpawnOptions so detach:false invariant is
  // enforced here too (Electron's Windows Job Object hosts the CLI child).
  //
  // cwd: MANAGED_DIR (~/.pi-dashboard) so the CLI's `#!/usr/bin/env node
  // --import tsx` shebang resolves `tsx` from the managed install's
  // node_modules. Using process.cwd() here breaks when the Electron app
  // is launched from a directory that has no node_modules/tsx (the typical
  // GUI launch case where cwd is `/` or the user's home).
  // See change: fix-managed-cli-cwd-tsx-resolution.
  const r = await spawnDetached(buildServerSpawnOptions({
    cmd: cliPath,
    args: ["start", "--port", String(port), "--pi-port", String(piPort)],
    env,
    cwd: MANAGED_DIR,
    logFd,
  }));
  if (!r.ok) {
    throw new Error(`pi-dashboard CLI failed to spawn: ${r.error}`);
  }

  const ready = await waitForReady({
    probe: async () => (await isDashboardRunning(port)).running,
    deadlineMs: SERVER_READY_DEADLINE_MS,
    child: r.process,
  });
  if (ready.ok) return;

  let logContent = "";
  try { logContent = readFileSync(logPath, "utf-8"); } catch { /* ignore */ }
  const lastLines = logContent.split("\n").slice(-20).join("\n");

  // Decorate with the AppImage-self-recursion hint on the CLI path — it's
  // useful diagnostic alongside the cause-aware base error. See change:
  // fix-electron-appimage-cli-self-detection (D5).
  const baseError = buildServerStartupError({
    cliPath,
    cwd: process.cwd(),
    logTail: lastLines,
    readyError: ready.error ?? "unknown",
    port,
    piPort,
  });
  throw new Error(
    baseError.message +
      `\nResolved CLI path: ${cliPath}\n` +
      `Verify with: readlink -f $(which pi-dashboard) \u2014 it should NOT point at the Electron binary or under $APPDIR`,
  );
}

/**
 * Launch the dashboard server as a detached background process.
 *
 * Legacy V1 path — reachable only when `LAUNCH_SOURCE_V2=false`.
 * Migrated in change `unify-server-launch-ts-loader` to delegate
 * loader resolution, argv shape, env merge, log header, and
 * readiness polling to the shared `launchDashboardServer` primitive.
 * tsx fallback dropped per the proposal (jiti is the only loader).
 */
async function launchServer(port: number, piPort: number): Promise<void> {
  const cliPath = findServerCli();
  if (!cliPath) {
    throw new Error("Dashboard server CLI not found. Run the setup wizard or reinstall the app.");
  }

  // Select the Node binary — bundled first, system fallback, execPath last resort.
  const bundledNode = getBundledNodePath();
  const bundledNodeDir = bundledNode ? path.dirname(path.dirname(bundledNode)) : null;
  // Probe the bundled Node's --version so pickNodeForServer can skip it when
  // it falls in the nodejs/node#58515 affected range (the server would refuse
  // to start on it anyway). Silent on errors — absence of version means no
  // version check, preserving legacy behavior. See change: skip-affected-bundled-node.
  let bundledNodeVersion: string | undefined;
  if (bundledNode) {
    try {
      bundledNodeVersion = execFileSync(bundledNode, ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
    } catch {
      bundledNodeVersion = undefined;
    }
  }
  const systemNode = detectSystemNode();
  const pick = pickNodeForServer({
    bundledNodeDir,
    systemNode,
    processExecPath: process.execPath,
    platform: process.platform,
    bundledNodeVersion,
  });

  const piResult = detectPi();
  const piBinDir = piResult.found && piResult.path ? path.dirname(piResult.path) : null;
  const nodeBinDir = path.dirname(pick.nodeBin);

  // PATH augmentation preserved from legacy V1: prepend pi bin + node bin
  // so the server's session-spawn code can find them in the spawned env.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  const extraPath = [piBinDir, nodeBinDir].filter(Boolean).join(path.delimiter);
  if (extraPath) env.PATH = `${extraPath}${path.delimiter}${env.PATH || ""}`;

  if (pick.kind === "execpath-fallback") {
    env["ELECTRON_RUN_AS_NODE"] = "1";
    console.warn(
      "[pick-node] No bundled or system Node found — falling back to process.execPath with " +
      "ELECTRON_RUN_AS_NODE=1. Server launch may behave unexpectedly. " +
      `execPath=${pick.nodeBin}`,
    );
  }

  // NODE_PATH augmentation preserved: bundled server's node_modules
  // and managed install's node_modules. The bundled server has its own
  // dependency tree at <cliPath>/../../../node_modules.
  const serverRoot = path.resolve(path.dirname(cliPath), "..", "..", "..");
  const bundledModules = path.join(serverRoot, "node_modules");
  const managedModules = path.join(MANAGED_DIR, "node_modules");
  env.NODE_PATH = [bundledModules, managedModules, env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);

  const logFile = getDashboardServerLogPath();

  try {
    await launchDashboardServer({
      cliPath,
      anchor: cliPath,
      nodeBin: pick.nodeBin,
      extraArgs: ["--port", String(port), "--pi-port", String(piPort)],
      env,
      starter: "Electron",
      stdio: { logFile },
      healthTimeoutMs: SERVER_READY_DEADLINE_MS,
      port,
      detach: false,
      cwd: serverRoot,
    });
  } catch (err: unknown) {
    let logContent = "";
    try { logContent = readFileSync(logFile, "utf-8"); } catch { /* ignore */ }
    const lastLines = logContent.split("\n").slice(-20).join("\n");
    let readyError = "unknown";
    if (err instanceof JitiNotFoundError) readyError = err.message;
    else if (err instanceof PortConflictError) readyError = err.message;
    else if (err instanceof EarlyExitError) readyError = `child exited (code=${err.code})`;
    else if (err instanceof Error) readyError = err.message;

    // Synthetic argv for the error message only — the real argv was
    // built and spawned by `launchDashboardServer`. Avoid a literal
    // node-import argv shape here so the lint does not match.
    const errorArgv = [pick.nodeBin, "--ts-loader=jiti", cliPath, "--port", String(port), "--pi-port", String(piPort)];
    throw buildServerStartupError({
      spawnBin: pick.nodeBin,
      spawnArgs: errorArgv,
      cwd: serverRoot,
      logTail: lastLines,
      readyError,
    });
  }
}

// ── User-initiated launch routine ──────────────────────────────────────────────
//
// `requestServerLaunch` is the single entry point shared by the loading-page
// "Start server" button, tray menu items, and any future in-app launch
// controls. It is idempotent under concurrent invocation: a single shared
// promise is reused while a launch is in flight.
// See change: electron-server-launch-controls (D1).

export type LaunchOutcome =
  | { kind: "already-running"; url: string }
  | { kind: "started"; url: string }
  | { kind: "failed"; reason: string; logTail: string };

export type LaunchStatus =
  | { phase: "starting" }
  | { phase: "shutting-down-existing" }
  | { phase: "spawning" }
  | { phase: "waiting-health" }
  | { phase: "ready"; url: string }
  | { phase: "failed"; message: string };

type LaunchStatusListener = (status: LaunchStatus) => void;
const launchStatusListeners = new Set<LaunchStatusListener>();

/** Subscribe to launch-status events. Returns an unsubscribe function. */
export function onLaunchStatus(cb: LaunchStatusListener): () => void {
  launchStatusListeners.add(cb);
  return () => { launchStatusListeners.delete(cb); };
}

function emitLaunchStatus(status: LaunchStatus): void {
  for (const cb of launchStatusListeners) {
    try { cb(status); } catch { /* listener errors are not our problem */ }
  }
}

let inflightLaunch: Promise<LaunchOutcome> | null = null;

/**
 * Probe whether the dashboard server is currently reachable.
 * Thin wrapper around `isDashboardRunning` that reads the configured port.
 */
export async function isManagedServerRunning(): Promise<boolean> {
  const config = loadMinimalConfig();
  const status = await isDashboardRunning(config.port);
  return status.running;
}

/**
 * Read the trailing `lines` lines (default 20) of `~/.pi/dashboard/server.log`.
 * Returns an empty string if the log is missing or unreadable. Reads at most
 * 8 KiB from the end of the file to bound memory.
 */
export async function readServerLogTail(lines: number = 20): Promise<string> {
  const logPath = getDashboardServerLogPath();
  try {
    if (!existsSync(logPath)) return "";
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(logPath);
    const TAIL_BYTES = 8192;
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const fd = await fs.open(logPath, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      await fd.read(buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      const allLines = text.split("\n");
      return allLines.slice(-lines).join("\n");
    } finally {
      await fd.close();
    }
  } catch {
    return "";
  }
}

/**
 * User-initiated server launch. Idempotent under concurrent calls.
 * Never throws — failures are returned as `{ kind: "failed", reason, logTail }`.
 */
export async function requestServerLaunch(opts: { force?: boolean } = {}): Promise<LaunchOutcome> {
  if (inflightLaunch) return inflightLaunch;
  inflightLaunch = (async (): Promise<LaunchOutcome> => {
    try {
      emitLaunchStatus({ phase: "starting" });
      const config = loadMinimalConfig();
      const url = `http://localhost:${config.port}`;
      const status = await isDashboardRunning(config.port);

      if (status.running && !opts.force) {
        emitLaunchStatus({ phase: "ready", url });
        return { kind: "already-running", url };
      }

      if (status.running && opts.force) {
        emitLaunchStatus({ phase: "shutting-down-existing" });
        try {
          await fetch(`${url}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(3000) });
        } catch { /* fall through; spawn will report port conflict if anything */ }
        // Wait up to 5s for the port to close.
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const probe = await isDashboardRunning(config.port);
          if (!probe.running) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      emitLaunchStatus({ phase: "spawning" });
      const startedUrl = await ensureServer();
      emitLaunchStatus({ phase: "waiting-health" });
      // ensureServer already waits for health internally — emit ready.
      emitLaunchStatus({ phase: "ready", url: startedUrl });
      return { kind: "started", url: startedUrl };
    } catch (err: any) {
      const reason = String(err?.message ?? err);
      const logTail = await readServerLogTail(20);
      emitLaunchStatus({ phase: "failed", message: reason });
      return { kind: "failed", reason, logTail };
    } finally {
      inflightLaunch = null;
    }
  })();
  return inflightLaunch;
}

/** Stop the server if we started it and own it. */
export async function stopServerIfNeeded(): Promise<void> {
  const config = loadMinimalConfig();
  const port = config.port;

  // V2 path: use health-based ownership check.
  if (storedSpawnedPid !== null) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const shouldStop = decideShutdownOnQuit({
          starter: typeof data.starter === "string" ? data.starter : undefined,
          healthPid: typeof data.pid === "number" ? data.pid : undefined,
          storedPid: storedSpawnedPid,
        });
        if (shouldStop) {
          try {
            await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });
          } catch { /* already stopped */ }
        }
      }
    } catch { /* server not reachable — already stopped */ }
    return;
  }

  // Legacy path: use serverStartedByUs flag.
  if (!serverStartedByUs) return;
  try {
    await fetch(`http://localhost:${port}/api/shutdown`, { method: "POST" });
  } catch { /* already stopped */ }
}
