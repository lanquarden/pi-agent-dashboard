/**
 * Bug C regression tests: `[launch-source]` diagnostics SHALL land in the
 * dashboard log file (~/.pi/dashboard/server.log) in addition to stderr.
 *
 * Why: packaged-Electron `.desktop` launches discard stderr on every host
 * OS shell, hiding every silent self-heal failure. The log-file write is
 * the only way users / developers can see what went wrong.
 *
 * See change: fix-electron-cold-launch-probe-cascade (Bug C).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { _testing, parsePreferOverride } from "../launch-source.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "launch-source-log-"));
  process.env.HOME = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("appendDashboardLog (Bug C)", () => {
  it("creates ~/.pi/dashboard/server.log on first write", () => {
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    expect(fs.existsSync(logFile)).toBe(false);

    _testing.appendDashboardLog("first line", logFile);

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[launch-source] first line");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });

  it("appends multiple lines without truncating", () => {
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    _testing.appendDashboardLog("first", logFile);
    _testing.appendDashboardLog("second", logFile);
    _testing.appendDashboardLog("third", logFile);

    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    expect(lines[2]).toContain("third");
  });

  it("never throws when the log directory cannot be created", () => {
    const blocker = path.join(tmpHome, "blocker");
    fs.writeFileSync(blocker, "");
    const impossibleLog = path.join(blocker, "server.log");
    expect(() => _testing.appendDashboardLog("noop", impossibleLog)).not.toThrow();
  });
});

describe("logLaunchSource (Bug C)", () => {
  it("writes to BOTH stderr (warn) and log file", () => {
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      _testing.logLaunchSource("warn", "[launch-source] hello warn", logFile);
      expect(warnSpy).toHaveBeenCalledWith("[launch-source] hello warn");
    } finally {
      warnSpy.mockRestore();
    }
    expect(fs.readFileSync(logFile, "utf-8")).toContain("[launch-source] hello warn");
  });

  it("writes to BOTH stderr (error) and log file", () => {
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      _testing.logLaunchSource("error", "[launch-source] hello error", logFile);
      expect(errSpy).toHaveBeenCalledWith("[launch-source] hello error");
    } finally {
      errSpy.mockRestore();
    }
    expect(fs.readFileSync(logFile, "utf-8")).toContain("[launch-source] hello error");
  });

  it("strips the [launch-source] prefix in the log body so it doesn't double-prefix", () => {
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      _testing.logLaunchSource("warn", "[launch-source] some detail", logFile);
    } finally {
      warnSpy.mockRestore();
    }
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).not.toContain("[launch-source] [launch-source]");
    expect(content).toContain("[launch-source] some detail");
  });
});

describe("integration: parsePreferOverride writes to log on bad value", () => {
  it("logs to ~/.pi/dashboard/server.log when DASHBOARD_PREFER_SOURCE is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = parsePreferOverride({ DASHBOARD_PREFER_SOURCE: "bogusValue" });
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
    const logFile = path.join(tmpHome, ".pi", "dashboard", "server.log");
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, "utf-8")).toContain("bogusValue");
  });
});
