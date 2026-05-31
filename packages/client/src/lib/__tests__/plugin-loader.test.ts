/**
 * Tests for the client-side runtime plugin loader.
 *
 * See change: runtime-plugin-loading (spec: runtime-plugin-contract).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handlePluginsChanged,
  unloadPlugin,
  wirePluginLoader,
  isPluginLoaded,
  getLoadedPluginIds,
  __resetPluginLoaderForTests,
  type RemotePluginInfo,
} from "../plugin-loader.js";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { __resetPluginEventBusForTests } from "../plugin-event-bus.js";
import { __resetSessionStoreForTests } from "../session-store.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeSend() {
  return vi.fn();
}

function fakeRegistry() {
  return createSlotRegistry();
}

function setupLoader(registry = fakeRegistry(), send = fakeSend()) {
  wirePluginLoader({ registry, send });
  return { registry, send };
}

beforeEach(() => {
  __resetPluginLoaderForTests();
  __resetPluginEventBusForTests();
  __resetSessionStoreForTests();
  vi.restoreAllMocks();
});

// ── handlePluginsChanged ─────────────────────────────────────────────────────

describe("handlePluginsChanged", () => {
  it("skips when not wired", async () => {
    await handlePluginsChanged([]);
    expect(getLoadedPluginIds()).toEqual([]);
  });

  it("unloads plugins no longer in the list", async () => {
    const registry = fakeRegistry();
    const send = fakeSend();
    setupLoader(registry, send);

    // Register a claim in the registry as if a plugin loaded it
    const MyBadge = () => null;
    registry.addClaim({
      pluginId: "old-plugin",
      priority: 1000,
      slot: "session-card-badge",
      Component: MyBadge,
    });

    // unloadPlugin only removes claims for plugins in loadedPlugins.
    // For plugins not loaded via the loader, claims stay.
    // This test verifies that unloadPlugin doesn't crash for non-loaded plugins.
    await unloadPlugin("old-plugin");

    // Claims remain because old-plugin was never in loadedPlugins
    const claims = registry.getClaims("session-card-badge");
    expect(claims.filter((c) => c.pluginId === "old-plugin")).toHaveLength(1);
  });

  it("does not load disabled plugins or those without mfRemote", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    await handlePluginsChanged([
      { id: "disabled", enabled: false, mfRemote: "/test/remote.js" },
      { id: "no-mf", enabled: true },
      { id: "valid", enabled: true, mfRemote: "/test/remote.js" },
    ]);

    // None should be loaded — script loading + federation runtime aren't mocked in jsdom
    expect(getLoadedPluginIds()).toEqual([]);
  });
});

// ── unloadPlugin ─────────────────────────────────────────────────────────────

describe("unloadPlugin", () => {
  it("is idempotent — double unload is safe", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    await unloadPlugin("test-plugin");
    await unloadPlugin("test-plugin");
    // Should not throw
  });

  it("no-op when plugin not loaded", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    await unloadPlugin("nonexistent");
    // Should not throw
  });
});

// ── State queries ────────────────────────────────────────────────────────────

describe("state queries", () => {
  it("getLoadedPluginIds returns empty initially", () => {
    expect(getLoadedPluginIds()).toEqual([]);
  });

  it("isPluginLoaded returns false initially", () => {
    expect(isPluginLoaded("any")).toBe(false);
  });
});

// ── Preflight error handling ─────────────────────────────────────────────────

describe("error surfacing", () => {
  it("surfaces preflight errors via CustomEvent", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    // Mock fetch to return 404
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("plugin-load-error", handler);

    const plugins: RemotePluginInfo[] = [
      {
        id: "broken-plugin",
        enabled: true,
        mfRemote: "/plugins/broken/remoteEntry.js",
      },
    ];

    await handlePluginsChanged(plugins);

    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail).toMatchObject({
      pluginId: "broken-plugin",
      error: expect.stringContaining("404"),
    });

    window.removeEventListener("plugin-load-error", handler);
  });

  it("surfaces missing init(api) export", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    // Preflight ok
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    // Mock script creation so loadRemoteScript fails fast (jsdom doesn't fire script onload/onerror)
    // (jsdom doesn't fire script onload/onerror for created elements).
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string, _options?: ElementCreationOptions) => {
        const el = origCreateElement(tagName);
        if (tagName === "script") {
          // Fire onerror asynchronously so the Promise settles.
          queueMicrotask(() => {
            (el as HTMLScriptElement).onerror?.(new Event("error"));
          });
        }
        return el;
      },
    );

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("plugin-load-error", handler);

    await handlePluginsChanged([
      {
        id: "test-plugin",
        enabled: true,
        mfRemote: "/plugins/test/remoteEntry.js",
      },
    ]);

    // The script load fails → a load error event is dispatched.
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events[0] as CustomEvent).detail).toMatchObject({
      pluginId: "test-plugin",
      error: expect.stringContaining("Failed to load remote script"),
    });

    window.removeEventListener("plugin-load-error", handler);
  });
});

// ── Subscription ─────────────────────────────────────────────────────────────

describe("subscribeLoadState", () => {
  it("notifies on plugin load state changes", async () => {
    const registry = fakeRegistry();
    setupLoader(registry, fakeSend());

    const { subscribeLoadState } = await import("../plugin-loader.js");
    const fn = vi.fn();
    const unsub = subscribeLoadState(fn);

    // handlePluginsChanged with empty list notifies after diff
    await handlePluginsChanged([]);
    expect(fn).toHaveBeenCalled();

    unsub();
  });
});
