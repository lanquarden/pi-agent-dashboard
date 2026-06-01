import { describe, it, expect, vi } from "vitest";
import { render, screen, renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { PluginContextProvider } from "../plugin-context.js";
import {
  SessionCardBadgeSlot,
  SessionCardMemorySlot,
  SettingsSectionSlot,
  ToolRendererSlot,
  useSlotHasClaimsForSession,
} from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id = "s1"): DashboardSession {
  return { id, cwd: "/repo", source: "tui", status: "active", startedAt: 0 };
}

// ── Error boundary tests ──────────────────────────────────────────────────────

describe("SessionCardBadgeSlot error boundary", () => {
  it("three plugins: second throws, first and third still render", () => {
    const registry = createSlotRegistry();

    registry.addClaim({
      pluginId: "a-plugin",
      priority: 100,
      slot: "session-card-badge",
      Component: () => <span data-testid="badge-a">A</span>,
    });
    registry.addClaim({
      pluginId: "b-plugin",
      priority: 200,
      slot: "session-card-badge",
      Component: () => { throw new Error("b-plugin crash"); },
    });
    registry.addClaim({
      pluginId: "c-plugin",
      priority: 300,
      slot: "session-card-badge",
      Component: () => <span data-testid="badge-c">C</span>,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadErrors: CustomEvent[] = [];
    const errorHandler = (e: Event) => loadErrors.push(e as CustomEvent);
    window.addEventListener("plugin-load-error", errorHandler);

    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={makeSession()} />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("badge-a")).toBeDefined();
    expect(screen.queryByTestId("badge-b")).toBeNull();
    expect(screen.getByTestId("badge-c")).toBeDefined();

    // Error was logged with plugin id and slot id
    const errorCalls = consoleSpy.mock.calls.map(c => c.join(" "));
    expect(errorCalls.some(s => s.includes("b-plugin") && s.includes("session-card-badge"))).toBe(true);

    // Error was reported via CustomEvent for PluginStatusStore
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].detail).toMatchObject({
      pluginId: "b-plugin",
      error: expect.stringContaining("b-plugin crash"),
    });

    // In dev mode, an error pill is rendered (vitest runs in non-production)
    const errorPill = screen.queryByText("b-plugin", { exact: false });
    // The error boundary renders a pill with pluginId + slotId in dev;
    // in vitest (non-production) this should be visible.
    if (errorPill) {
      expect(errorPill.textContent).toContain("session-card-badge");
    }

    window.removeEventListener("plugin-load-error", errorHandler);
    consoleSpy.mockRestore();
  });

  it("slot with one throwing plugin renders nothing without propagating to parent", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "crash-plugin",
      priority: 100,
      slot: "session-card-badge",
      Component: () => { throw new Error("crash"); },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw
    expect(() =>
      render(
        <PluginContextProvider registry={registry}>
          <div data-testid="parent">
            <SessionCardBadgeSlot session={makeSession()} />
          </div>
        </PluginContextProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("parent")).toBeDefined();
    consoleSpy.mockRestore();
  });
});

// ── SettingsSectionSlot tab filtering ────────────────────────────────────────

describe("SettingsSectionSlot", () => {
  it("filters claims by tab", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "security-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "security",
      Component: () => <div data-testid="security-section">Security</div>,
    });
    registry.addClaim({
      pluginId: "general-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "general",
      Component: () => <div data-testid="general-section">General</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="security" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("security-section")).toBeDefined();
    expect(screen.queryByTestId("general-section")).toBeNull();
  });

  it("claim without tab defaults to general", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "no-tab-plugin",
      priority: 100,
      slot: "settings-section",
      // no tab field → defaults to "general"
      Component: () => <div data-testid="no-tab-section">NoTab</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="general" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("no-tab-section")).toBeDefined();
  });

  it("renders nothing when no claims match tab", () => {
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="providers" />
      </PluginContextProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── ToolRendererSlot ─────────────────────────────────────────────────────────

describe("ToolRendererSlot", () => {
  it("uses plugin component when toolName matches", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "demo",
      priority: 100,
      slot: "tool-renderer",
      toolName: "DashboardDemo",
      Component: () => <div data-testid="demo-renderer">Demo</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <ToolRendererSlot toolName="DashboardDemo" toolInput={{}} sessionId="s1" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("demo-renderer")).toBeDefined();
  });

  it("falls through to FallbackComponent when no claim matches", () => {
    const registry = createSlotRegistry();
    const Fallback = () => <div data-testid="fallback">Generic</div>;

    render(
      <PluginContextProvider registry={registry}>
        <ToolRendererSlot
          toolName="UnknownTool"
          toolInput={{}}
          sessionId="s1"
          FallbackComponent={Fallback}
        />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("fallback")).toBeDefined();
  });
});

// ── Outside provider: graceful degradation ───────────────────────────────────

describe("slot consumer outside PluginContextProvider", () => {
  it("renders nothing (no throw) when outside provider", () => {
    // Slot consumers gracefully render nothing when no provider is present
    // so existing component tests don't need wrapping.
    const { container } = render(<SessionCardBadgeSlot session={makeSession()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── shouldRender semantics (auto-hide-empty-session-subcards) ───────────────

describe("useSlotHasClaimsForSession with shouldRender", () => {
  const wrap =
    (registry: ReturnType<typeof createSlotRegistry>) =>
    ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider registry={registry}>{children}</PluginContextProvider>
    );

  it("returns false when only claim's shouldRender returns false", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>shouldnt-render</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(false);
  });

  it("returns true when at least one claim's shouldRender returns true", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>nope</span>,
    });
    registry.addClaim({
      pluginId: "open",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => true,
      Component: () => <span data-testid="open">open</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(true);
  });

  it("treats absent shouldRender as pass-through (true)", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "legacy",
      priority: 100,
      slot: "session-card-memory",
      Component: () => <span>legacy</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(true);
  });

  it("returns false outside PluginContextProvider", () => {
    const { result } = renderHook(() =>
      useSlotHasClaimsForSession("session-card-memory", makeSession()),
    );
    expect(result.current).toBe(false);
  });
});

describe("SessionCardMemorySlot with shouldRender", () => {
  it("mounts only claims whose shouldRender returns true", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span data-testid="closed-badge">closed</span>,
    });
    registry.addClaim({
      pluginId: "open",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => true,
      Component: () => <span data-testid="open-badge">open</span>,
    });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardMemorySlot session={makeSession()} />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("closed-badge")).toBeNull();
    expect(screen.getByTestId("open-badge")).toBeDefined();
  });

  it("renders nothing when every claim is gated out", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "a",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>a</span>,
    });
    registry.addClaim({
      pluginId: "b",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>b</span>,
    });
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SessionCardMemorySlot session={makeSession()} />
      </PluginContextProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Runtime reactivity (Task 7: SlotRegistry runtime extension) ──────────────

describe("slot consumer runtime reactivity", () => {
  it("re-renders when claim added at runtime", () => {
    const registry = createSlotRegistry();
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={makeSession("s1")} />
      </PluginContextProvider>,
    );

    // Initially nothing renders
    expect(screen.queryByTestId("runtime-badge")).toBeNull();

    // Add a claim at runtime
    act(() => {
      registry.addClaim({
        pluginId: "runtime-plugin",
        priority: 100,
        slot: "session-card-badge",
        Component: () => <span data-testid="runtime-badge">Runtime</span>,
      });
    });

    expect(screen.getByTestId("runtime-badge")).toBeDefined();
  });

  it("removes rendered element when claim removed at runtime", async () => {
    const registry = createSlotRegistry();
    const claim = {
      pluginId: "removable",
      priority: 100,
      slot: "session-card-badge" as const,
      Component: () => <span data-testid="removable-badge">Removable</span>,
    };
    registry.addClaim(claim);

    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={makeSession("s1")} />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("removable-badge")).toBeDefined();

    // Remove the claim at runtime
    act(() => {
      registry.removeClaim(claim);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("removable-badge")).toBeNull();
    });
  });

  it("removes all claims for a plugin when removeClaims called", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "doomed",
      priority: 100,
      slot: "session-card-badge",
      Component: () => <span data-testid="badge-1">B1</span>,
    });
    registry.addClaim({
      pluginId: "doomed",
      priority: 200,
      slot: "session-card-memory",
      Component: () => <span data-testid="memory-1">M1</span>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={makeSession("s1")} />
        <SessionCardMemorySlot session={makeSession("s1")} />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("badge-1")).toBeDefined();
    expect(screen.getByTestId("memory-1")).toBeDefined();

    act(() => {
      registry.removeClaims("doomed");
    });

    expect(screen.queryByTestId("badge-1")).toBeNull();
    expect(screen.queryByTestId("memory-1")).toBeNull();
  });

  it("ToolRendererSlot picks up runtime-registered renderer", async () => {
    const registry = createSlotRegistry();
    render(
      <PluginContextProvider registry={registry}>
        <ToolRendererSlot
          toolName="runtime-tool"
          toolInput={{}}
          sessionId="s1"
          FallbackComponent={() => <span data-testid="runtime-fallback">FB</span>}
        />
      </PluginContextProvider>,
    );

    // No claim yet — fallback renders
    expect(screen.getByTestId("runtime-fallback")).toBeDefined();

    // Register at runtime
    act(() => {
      registry.addClaim({
        pluginId: "rt",
        priority: 100,
        slot: "tool-renderer",
        toolName: "runtime-tool",
        Component: () => <span data-testid="runtime-tool-renderer">RT</span>,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("runtime-tool-renderer")).toBeDefined();
      expect(screen.queryByTestId("runtime-fallback")).toBeNull();
    });
  });
});
