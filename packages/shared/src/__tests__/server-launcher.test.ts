/**
 * Unit tests for `launchDashboardServer`.
 *
 * Mocks the test seams (`_resolveJiti`, `_spawnNodeScript`,
 * `_isDashboardRunning`, `_fs`, `_sleep`, `_now`) so the launcher's
 * orchestration logic is exercised without spawning a real child or
 * touching the filesystem.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  launchDashboardServer,
  JitiNotFoundError,
  PortConflictError,
  EarlyExitError,
} from "../server-launcher.js";
import type { ChildProcess } from "node:child_process";
import type { spawnNodeScript } from "../platform/node-spawn.js";
import type { isDashboardRunning } from "../server-identity.js";

const spawnSpy = (impl: () => ChildProcess) =>
  vi.fn<typeof spawnNodeScript>(impl as unknown as typeof spawnNodeScript);
const probeSpy = <T>(impl: () => Promise<T>) =>
  vi.fn<typeof isDashboardRunning>(impl as unknown as typeof isDashboardRunning);

interface FakeChildOpts {
  pid?: number | null;
  exitCode?: number | null;
}

function makeFakeChild(opts: FakeChildOpts = {}): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess & {
    pid: number | undefined;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    unref: () => void;
  };
  ee.pid = (opts.pid ?? 12345) as number | undefined;
  ee.exitCode = opts.exitCode ?? null;
  ee.signalCode = null;
  ee.unref = vi.fn();
  return ee;
}

function baseOpts(overrides: Partial<Parameters<typeof launchDashboardServer>[0]> = {}) {
  return {
    cliPath: "/srv/cli.ts",
    stdio: "ignore" as const,
    healthTimeoutMs: 5000,
    port: 8000,
    _resolveJiti: () => "file:///loader/jiti-register.mjs",
    _spawnNodeScript: spawnSpy(() => makeFakeChild()),
    _isDashboardRunning: probeSpy(async () => ({ running: true, pid: 99 })),
    _sleep: () => Promise.resolve(),
    _pollIntervalMs: 1,
    ...overrides,
  };
}

describe("launchDashboardServer — happy path", () => {
  it("returns childPid + reportedPid + healthOk on first health-ok poll", async () => {
    const result = await launchDashboardServer(baseOpts());
    expect(result.childPid).toBe(12345);
    expect(result.reportedPid).toBe(99);
    expect(result.healthOk).toBe(true);
  });

  it("delegates argv to spawnNodeScript with loader + entry + args", async () => {
    const spy = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spy,
      extraArgs: ["--port", "8000", "--pi-port", "9999"],
    }));
    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0]![0]!;
    expect(call.loader).toBe("file:///loader/jiti-register.mjs");
    expect(call.entry).toBe("/srv/cli.ts");
    expect(call.args).toEqual(["--port", "8000", "--pi-port", "9999"]);
    expect(call.spawnOptions?.detached).toBe(true);
    expect(call.spawnOptions?.windowsHide).toBe(true);
    expect(call.spawnOptions?.stdio).toBe("ignore");
  });
});

describe("launchDashboardServer — jiti resolution", () => {
  it("throws JitiNotFoundError when resolveJiti returns null (no spawn)", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await expect(launchDashboardServer(baseOpts({
      _resolveJiti: () => null,
      _spawnNodeScript: spawn,
    }))).rejects.toBeInstanceOf(JitiNotFoundError);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("launchDashboardServer — readiness termination", () => {
  it("throws PortConflictError when probe reports portConflict", async () => {
    await expect(launchDashboardServer(baseOpts({
      _isDashboardRunning: async () => ({ running: false, portConflict: true }),
    }))).rejects.toBeInstanceOf(PortConflictError);
  });

  it("throws EarlyExitError when child exits during poll", async () => {
    const child = makeFakeChild();
    let calls = 0;
    const spawnFn = spawnSpy(() => child);
    const probe = probeSpy(async () => {
      calls++;
      if (calls === 1) {
        // Mid-poll, child crashes.
        (child as unknown as { exitCode: number }).exitCode = 7;
      }
      return { running: false };
    });
    await expect(launchDashboardServer(baseOpts({
      _spawnNodeScript: spawnFn,
      _isDashboardRunning: probe,
    }))).rejects.toBeInstanceOf(EarlyExitError);
  });

  it("throws readiness-timeout Error after healthTimeoutMs elapses", async () => {
    let now = 1000;
    await expect(launchDashboardServer(baseOpts({
      healthTimeoutMs: 100,
      _now: () => { now += 60; return now; }, // each poll advances 60ms — 2 polls past deadline
      _isDashboardRunning: async () => ({ running: false }),
    }))).rejects.toThrow(/readiness timeout/);
  });

  it("port-conflict beats timeout (probe order respected)", async () => {
    let now = 1000;
    await expect(launchDashboardServer(baseOpts({
      healthTimeoutMs: 100,
      _now: () => { now += 200; return now; },
      _isDashboardRunning: async () => ({ running: false, portConflict: true }),
    }))).rejects.toBeInstanceOf(PortConflictError);
  });
});

describe("launchDashboardServer — log-file stdio", () => {
  it("mkdirs parent, opens append fd, writes header, passes fd, closes parent's copy", async () => {
    const calls: string[] = [];
    const fsStub = {
      mkdirSync: vi.fn((p: any) => { calls.push(`mkdir:${p}`); }),
      openSync: vi.fn((p: any, mode: any) => { calls.push(`open:${p}:${mode}`); return 42; }),
      writeSync: vi.fn((fd: number, s: any) => { calls.push(`write:${fd}:${String(s).slice(0, 20)}…`); return s.length; }),
      closeSync: vi.fn((fd: number) => { calls.push(`close:${fd}`); }),
    };
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      stdio: { logFile: "/var/log/dashboard/server.log" },
      starter: "Standalone",
      _fs: fsStub as any,
      _spawnNodeScript: spawn,
    }));
    expect(fsStub.mkdirSync).toHaveBeenCalledWith("/var/log/dashboard", { recursive: true });
    expect(fsStub.openSync).toHaveBeenCalledWith("/var/log/dashboard/server.log", "a");
    expect(fsStub.writeSync).toHaveBeenCalledOnce();
    expect(String(fsStub.writeSync.mock.calls[0]![1])).toContain("Standalone launch");
    // Spawn received [ignore, fd, fd]:
    const stdio = spawn.mock.calls[0]![0]!.spawnOptions!.stdio as Array<unknown>;
    expect(stdio).toEqual(["ignore", 42, 42]);
    // Parent fd closed AFTER spawn:
    expect(fsStub.closeSync).toHaveBeenCalledWith(42);
    const closeIdx = calls.findIndex((c) => c.startsWith("close:42"));
    const writeIdx = calls.findIndex((c) => c.startsWith("write:42"));
    expect(closeIdx).toBeGreaterThan(writeIdx);
  });
});

describe("launchDashboardServer — env merge", () => {
  it("caller env keys override buildSpawnEnv defaults", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawn,
      env: { DASHBOARD_STARTER: "Bridge", CUSTOM_KEY: "x" },
    }));
    const env = spawn.mock.calls[0]![0]!.spawnOptions!.env as Record<string, string>;
    expect(env.DASHBOARD_STARTER).toBe("Bridge");
    expect(env.CUSTOM_KEY).toBe("x");
  });

  it("starter option becomes DASHBOARD_STARTER when env does not supply it", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawn,
      starter: "Electron",
    }));
    const env = spawn.mock.calls[0]![0]!.spawnOptions!.env as Record<string, string>;
    expect(env.DASHBOARD_STARTER).toBe("Electron");
  });

  it("explicit env.DASHBOARD_STARTER wins over starter option", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawn,
      starter: "Electron",
      env: { DASHBOARD_STARTER: "Bridge" },
    }));
    const env = spawn.mock.calls[0]![0]!.spawnOptions!.env as Record<string, string>;
    expect(env.DASHBOARD_STARTER).toBe("Bridge");
  });
});

describe("launchDashboardServer — onChildExit (cherry-pick 6a)", () => {
  it("invokes onChildExit when child emits exit after readiness", async () => {
    const child = makeFakeChild();
    const onChildExit = vi.fn();
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawnSpy(() => child),
      onChildExit,
    }));
    // Simulate post-readiness crash
    (child as unknown as EventEmitter).emit("exit", 1, null);
    expect(onChildExit).toHaveBeenCalledOnce();
    expect(onChildExit).toHaveBeenCalledWith(1, null);
  });

  it("fires only once even if exit emitted twice", async () => {
    const child = makeFakeChild();
    const onChildExit = vi.fn();
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawnSpy(() => child),
      onChildExit,
    }));
    (child as unknown as EventEmitter).emit("exit", 0, null);
    (child as unknown as EventEmitter).emit("exit", 0, null);
    expect(onChildExit).toHaveBeenCalledOnce(); // child.once not child.on
  });

  it("does NOT attach any listener when onChildExit omitted", async () => {
    const child = makeFakeChild();
    const listenersBefore = (child as unknown as EventEmitter).listenerCount("exit");
    await launchDashboardServer(baseOpts({ _spawnNodeScript: spawnSpy(() => child) }));
    const listenersAfter = (child as unknown as EventEmitter).listenerCount("exit");
    expect(listenersAfter).toBe(listenersBefore);
  });
});

describe("launchDashboardServer — entry URL-wrapping", () => {
  // The launcher delegates to spawnNodeScript, which uses
  // `shouldUrlWrapEntry(loader, platform)`. We verify the launcher
  // simply forwards the raw entry; the URL-wrap behaviour itself is
  // pinned by node-spawn-jiti-contract.test.ts.
  it("forwards `cliPath` verbatim to spawnNodeScript (URL-wrapping owned downstream)", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawn,
      cliPath: "/posix/cli.ts",
    }));
    expect(spawn.mock.calls[0]![0]!.entry).toBe("/posix/cli.ts");
  });

  it("forwards Windows-style `cliPath` verbatim too", async () => {
    const spawn = spawnSpy(() => makeFakeChild());
    await launchDashboardServer(baseOpts({
      _spawnNodeScript: spawn,
      cliPath: "C:\\srv\\cli.ts",
    }));
    expect(spawn.mock.calls[0]![0]!.entry).toBe("C:\\srv\\cli.ts");
  });
});
