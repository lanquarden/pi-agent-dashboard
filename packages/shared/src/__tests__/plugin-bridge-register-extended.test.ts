/**
 * Task 9.3: Bridge auto-register extended tests.
 * Verifies: write on boot, remove on disable, preserve user entries,
 * surface path-mismatch conflicts.
 */
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-ext-test-"));
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

describe("bridge auto-register boot + disable lifecycle", () => {
  it("registers bridge on first boot", () => {
    const result = registerPluginBridge("openspec", "/opt/dashboard/openspec/bridge.js", { homedir });
    expect(result.type).toBe("ok");
    const managed = listManagedBridges({ homedir });
    expect(managed["dashboard-openspec"]).toBe("/opt/dashboard/openspec/bridge.js");
  });

  it("deregisters bridge on disable", () => {
    registerPluginBridge("openspec", "/opt/dashboard/openspec/bridge.js", { homedir });
    deregisterPluginBridge("openspec", { homedir });
    const managed = listManagedBridges({ homedir });
    expect(Object.keys(managed)).toHaveLength(0);
  });

  it("preserves user-owned packages array and appends managed bridge", () => {
    // Per change fix-pi-flows-end-to-end Group 1: dual-write appends the
    // managed bridge to packages[] (with ownership marker) while leaving
    // user entries untouched in original order.
    fs.mkdirSync(path.join(homedir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify({
        packages: ["/user/my-extension", "/user/another"],
      }),
    );
    registerPluginBridge("demo", "/demo/bridge.js", { homedir });
    const settings = readSettings();
    expect(settings.packages).toEqual([
      "/user/my-extension",
      "/user/another",
      "/demo/bridge.js",
    ]);
  });

  it("surfaces path-mismatch conflict without overwriting", () => {
    // On-disk path must exist for a real conflict (self-heal would otherwise
    // silently replace — see add-plugin-activation-ui).
    const oldPath = path.join(tmpDir, "old-bridge.js");
    const newPath = path.join(tmpDir, "new-bridge.js");
    fs.writeFileSync(oldPath, "// existing bridge");
    registerPluginBridge("openspec", oldPath, { homedir });
    const result = registerPluginBridge("openspec", newPath, { homedir });
    expect(result.type).toBe("conflict");
    // Original path preserved
    const managed = listManagedBridges({ homedir });
    expect(managed["dashboard-openspec"]).toBe(oldPath);
  });
});
