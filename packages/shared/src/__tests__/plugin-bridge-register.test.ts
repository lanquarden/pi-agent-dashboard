import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerPluginBridge,
  deregisterPluginBridge,
  listManagedBridges,
} from "../plugin-bridge-register.js";

let tmpDir: string;
let homedir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-bridge-test-"));
  homedir = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function settingsPath() {
  return path.join(homedir, ".pi", "agent", "settings.json");
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
}

describe("registerPluginBridge", () => {
  it("writes dashboard-<id> entry under dashboardPluginBridges", () => {
    const result = registerPluginBridge("demo", "/path/to/demo/bridge.js", { homedir });
    expect(result.type).toBe("ok");
    const s = readSettings();
    const managed = s.dashboardPluginBridges as Record<string, string>;
    expect(managed["dashboard-demo"]).toBe("/path/to/demo/bridge.js");
  });

  it("returns ok when entry already matches (idempotent)", () => {
    registerPluginBridge("demo", "/path/to/bridge.js", { homedir });
    const result = registerPluginBridge("demo", "/path/to/bridge.js", { homedir });
    expect(result.type).toBe("ok");
  });

  it("returns conflict when entry exists with different path", () => {
    // The on-disk path must exist for a real conflict (otherwise the
    // self-heal path silently replaces — see add-plugin-activation-ui).
    const oldPath = path.join(tmpDir, "old-bridge.js");
    const newPath = path.join(tmpDir, "new-bridge.js");
    fs.writeFileSync(oldPath, "// existing bridge");
    registerPluginBridge("demo", oldPath, { homedir });
    const result = registerPluginBridge("demo", newPath, { homedir });
    expect(result.type).toBe("conflict");
    if (result.type === "conflict") {
      expect(result.existingPath).toBe(oldPath);
      expect(result.newPath).toBe(newPath);
    }
    // Should not overwrite
    const s = readSettings();
    const managed = s.dashboardPluginBridges as Record<string, string>;
    expect(managed["dashboard-demo"]).toBe(oldPath);
  });

  it("appends managed bridge to packages[] while preserving user-owned entries", () => {
    // Per change fix-pi-flows-end-to-end Group 1: dual-write into packages[]
    // is required (pi-coding-agent reads packages[], not dashboardPluginBridges).
    // User entries MUST be preserved in original order; the managed bridge
    // path MUST be appended and recorded in the ownership map.
    fs.mkdirSync(path.join(homedir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({ packages: ["/user/extension1", "/user/extension2"] }),
    );

    registerPluginBridge("demo", "/demo/bridge.js", { homedir });
    const s = readSettings();
    expect(s.packages).toEqual(["/user/extension1", "/user/extension2", "/demo/bridge.js"]);
    expect((s._dashboardManagedPackages as Record<string, string>)["/demo/bridge.js"]).toBe(
      "dashboard-demo",
    );
  });
});

describe("deregisterPluginBridge", () => {
  it("removes the managed entry", () => {
    registerPluginBridge("demo", "/demo/bridge.js", { homedir });
    deregisterPluginBridge("demo", { homedir });
    const s = readSettings();
    const managed = s.dashboardPluginBridges as Record<string, string>;
    expect(managed["dashboard-demo"]).toBeUndefined();
  });

  it("is a no-op when entry does not exist", () => {
    // Should not throw
    expect(() => deregisterPluginBridge("nonexistent", { homedir })).not.toThrow();
  });

  it("does not remove other plugin entries", () => {
    registerPluginBridge("a", "/a/bridge.js", { homedir });
    registerPluginBridge("b", "/b/bridge.js", { homedir });
    deregisterPluginBridge("a", { homedir });
    const managed = listManagedBridges({ homedir });
    expect(managed["dashboard-a"]).toBeUndefined();
    expect(managed["dashboard-b"]).toBe("/b/bridge.js");
  });
});

describe("listManagedBridges", () => {
  it("returns all managed entries", () => {
    registerPluginBridge("a", "/a/bridge.js", { homedir });
    registerPluginBridge("b", "/b/bridge.js", { homedir });
    const managed = listManagedBridges({ homedir });
    expect(Object.keys(managed)).toHaveLength(2);
    expect(managed["dashboard-a"]).toBe("/a/bridge.js");
    expect(managed["dashboard-b"]).toBe("/b/bridge.js");
  });

  it("returns empty object when no plugins registered", () => {
    const managed = listManagedBridges({ homedir });
    expect(managed).toEqual({});
  });
});
