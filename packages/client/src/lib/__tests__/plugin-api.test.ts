/**
 * Tests for createDashboardPluginApi and initDashboardPluginApi.
 *
 * See change: runtime-plugin-loading (spec: dashboard-plugin-api).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  createDashboardPluginApi,
  initDashboardPluginApi,
  subscribeToasts,
} from "../plugin-api.js";
import { setSessionSnapshot, __resetSessionStoreForTests } from "../session-store.js";
import { __resetPluginEventBusForTests } from "../plugin-event-bus.js";
import type {
  DashboardSession,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
// Direct imports for tool-renderer registry assertions (ESM, not require).
import {
  getToolRenderer,
  getToolHeaderChips,
  getToolSummary,
} from "../../components/tool-renderers/registry.js";
// Import plugin config reset for test isolation.
import {
  initPluginConfigs,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockSession(id: string): DashboardSession {
  return {
    id,
    cwd: `/home/test/${id}`,
    source: "spawn" as DashboardSession["source"],
    status: "alive" as DashboardSession["status"],
    startedAt: Date.now(),
  };
}

function fakeSend(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

function makeApi(registry: SlotRegistry, send = fakeSend()) {
  const cleanups: (() => void)[] = [];
  const onCleanup = (fn: () => void) => cleanups.push(fn);
  const api = createDashboardPluginApi(
    { registry, send },
    "test-plugin",
    onCleanup,
  );
  return { api, cleanups, send };
}

beforeEach(() => {
  __resetSessionStoreForTests();
  __resetPluginEventBusForTests();
  // Reset plugin configs for test isolation.
  // initPluginConfigs only sets configs for keys in the input, so we
  // explicitly clear the "test-plugin" config used by all tests.
  initPluginConfigs({ "test-plugin": {} });
});

// ── registerClaim validation ─────────────────────────────────────────────────

describe("registerClaim validation", () => {
  it("throws TypeError for invalid slot id", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    expect(() =>
      api.registerClaim({ slot: "bogus", component: () => null }),
    ).toThrow(TypeError);
    expect(() =>
      api.registerClaim({ slot: "bogus", component: () => null }),
    ).toThrow("Invalid slot");
  });

  it("throws TypeError for react slot missing component", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // session-card-badge is react-or-descriptor, needs component
    expect(() =>
      api.registerClaim({ slot: "session-card-badge" }),
    ).toThrow(TypeError);
    expect(() =>
      api.registerClaim({ slot: "session-card-badge" }),
    ).toThrow("requires a React component");
  });

  it("does not throw for descriptor-only slots without component", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // footer-segment is descriptor-only — component is optional
    expect(() =>
      api.registerClaim({ slot: "footer-segment" }),
    ).not.toThrow();
  });

  it("throws for tool-renderer slot missing toolName", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    expect(() =>
      api.registerClaim({ slot: "tool-renderer", component: () => null }),
    ).toThrow(TypeError);
    expect(() =>
      api.registerClaim({ slot: "tool-renderer", component: () => null }),
    ).toThrow("requires a toolName");
  });
});

// ── registerClaim: slot registry integration ─────────────────────────────────

describe("registerClaim: slot registry", () => {
  it("adds claim to registry and returns unregister", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const MyBadge = () => null;
    const unreg = api.registerClaim({
      slot: "session-card-badge",
      component: MyBadge,
    });

    const claims = registry.getClaims("session-card-badge");
    // Find our claim
    const ours = claims.filter((c) => c.pluginId === "test-plugin");
    expect(ours).toHaveLength(1);
    expect(ours[0].Component).toBe(MyBadge);

    // Unregister
    unreg();
    const after = registry.getClaims("session-card-badge");
    const afterOurs = after.filter((c) => c.pluginId === "test-plugin");
    expect(afterOurs).toHaveLength(0);
  });

  it("passes through extra fields (command, tab, path)", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    api.registerClaim({
      slot: "command-route",
      component: () => null,
      command: "/test-cmd",
    });

    const claims = registry.getClaims("command-route");
    const ours = claims.find((c) => c.pluginId === "test-plugin");
    expect(ours?.command).toBe("/test-cmd");
  });
});

// ── registerClaim: tool-renderer delegation ──────────────────────────────────

describe("registerClaim: tool-renderer delegation", () => {
  it("delegates to registerToolRenderer", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const MyBashRenderer = () => null;
    const myChips = vi.fn(() => []);

    api.registerClaim({
      slot: "tool-renderer",
      toolName: "bash",
      component: MyBashRenderer,
      headerChips: myChips,
      summary: () => "summary",
    });

    expect(getToolRenderer("bash")).toBe(MyBashRenderer);
    expect(getToolHeaderChips("bash")).toBe(myChips);
    expect(getToolSummary("bash")?.()).toBe("summary");
  });

  it("restores original renderer on unregister", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // Save original
    const original = getToolRenderer("bash");

    // Register plugin renderer
    const PluginRenderer = () => null;
    const unreg = api.registerClaim({
      slot: "tool-renderer",
      toolName: "bash",
      component: PluginRenderer,
    });

    expect(getToolRenderer("bash")).toBe(PluginRenderer);

    // Unregister should restore original
    unreg();
    expect(getToolRenderer("bash")).toBe(original);
  });
});

// ── Session access ───────────────────────────────────────────────────────────

describe("session access", () => {
  it("getSession returns session by id", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const s1 = mockSession("s1");
    const s2 = mockSession("s2");
    setSessionSnapshot([s1, s2]);

    expect(api.getSession("s1")).toBe(s1);
    expect(api.getSession("s2")).toBe(s2);
    expect(api.getSession("nonexistent")).toBeUndefined();
  });

  it("getAllSessions returns all sessions", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const sessions = [mockSession("a"), mockSession("b"), mockSession("c")];
    setSessionSnapshot(sessions);

    expect(api.getAllSessions()).toEqual(sessions);
    expect(api.getAllSessions()).toHaveLength(3);
  });

  it("subscribeSession fires on changes", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const fn = vi.fn();
    api.subscribeSession(fn);

    // Initial snapshot is empty, fn hasn't been called yet for the initial state
    // (subscribeSession only fires on subsequent changes)
    expect(fn).not.toHaveBeenCalled();

    setSessionSnapshot([mockSession("new")]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith([mockSession("new")]);

    // Multiple changes
    setSessionSnapshot([mockSession("a"), mockSession("b")]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── Event subscription ───────────────────────────────────────────────────────

describe("onEvent", () => {
  it("fires for matching event type", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const fn = vi.fn();
    api.onEvent("session_updated", fn);

    api._emitEvent("session_updated", { type: "session_updated", sessionId: "1" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire for non-matching event type", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const fn = vi.fn();
    api.onEvent("pi-dev-worktrees:state", fn);

    api._emitEvent("session_updated", { type: "session_updated" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("unsubscribe stops firing", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const fn = vi.fn();
    const unsub = api.onEvent("test", fn);

    api._emitEvent("test", {});
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    api._emitEvent("test", {});
    expect(fn).toHaveBeenCalledTimes(1); // no additional call
  });
});

// ── Config ───────────────────────────────────────────────────────────────────

describe("config", () => {
  it("getConfig returns empty object before any config set", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    expect(api.getConfig()).toEqual({});
  });

  it("setConfig sends WS message and applies optimistically", async () => {
    const registry = createSlotRegistry();
    const send = fakeSend();
    const { api } = makeApi(registry, send);

    await api.setConfig({ theme: "dark" });

    // Should have sent WS message
    expect(send).toHaveBeenCalledWith({
      type: "set_plugin_config",
      id: "test-plugin",
      config: { theme: "dark" },
    });

    // Optimistic application: getConfig should reflect the change
    expect(api.getConfig()).toEqual({ theme: "dark" });
  });

  it("setConfig merges with existing config", async () => {
    const registry = createSlotRegistry();
    const send = fakeSend();
    const { api } = makeApi(registry, send);

    await api.setConfig({ a: 1 });
    await api.setConfig({ b: 2 });

    expect(api.getConfig()).toEqual({ a: 1, b: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

// ── showToast ────────────────────────────────────────────────────────────────

describe("showToast", () => {
  it("dispatches toast to subscribers", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    const fn = vi.fn();
    subscribeToasts(fn);

    api.showToast("Hello");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Hello", variant: "info" }),
    );

    api.showToast("Error!", "error");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Error!", variant: "error" }),
    );
  });
});

// ── initDashboardPluginApi: proxy replay ─────────────────────────────────────

describe("initDashboardPluginApi", () => {
  it("replays queued calls from the pre-React proxy", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // Simulate a proxy with queued calls
    const MyBadge = () => null;
    const queuedCalls = [
      { method: "registerClaim", args: [{ slot: "session-card-badge", component: MyBadge }] },
      { method: "getAllSessions", args: [] },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__piDashboard = {
      __isProxy: true,
      __queue: queuedCalls,
    };

    initDashboardPluginApi(api);

    // After init, window.__piDashboard should be the real API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).__piDashboard).toBe(api);

    // The queued registerClaim should have been replayed
    const claims = registry.getClaims("session-card-badge");
    const ours = claims.filter((c) => c.pluginId === "test-plugin");
    expect(ours).toHaveLength(1);
    expect(ours[0].Component).toBe(MyBadge);
  });

  it("handles empty proxy (no queue)", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__piDashboard = {
      __isProxy: true,
      __queue: [],
    };

    initDashboardPluginApi(api);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).__piDashboard).toBe(api);
  });

  it("ignores non-proxy objects", () => {
    const registry = createSlotRegistry();
    const { api } = makeApi(registry);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__piDashboard = { someOtherThing: true };

    initDashboardPluginApi(api);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).__piDashboard).toBe(api);
  });
});

// ── Cleanup tracking ─────────────────────────────────────────────────────────

describe("cleanup tracking", () => {
  it("collects cleanup functions for bulk unload", () => {
    const registry = createSlotRegistry();
    const { api, cleanups } = makeApi(registry);

    api.registerClaim({
      slot: "session-card-badge",
      component: () => null,
    });
    api.registerClaim({
      slot: "settings-section",
      component: () => null,
    });

    expect(cleanups).toHaveLength(2);

    // Call all cleanups
    for (const fn of cleanups) fn();

    // No claims should remain for test-plugin
    const claims = registry.getClaims("session-card-badge");
    expect(claims.filter((c) => c.pluginId === "test-plugin")).toHaveLength(0);
  });
});
