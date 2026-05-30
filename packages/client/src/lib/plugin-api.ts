/**
 * DashboardPluginApi factory and browser-global wiring.
 *
 * `createDashboardPluginApi(deps, pluginId)` produces the API object passed
 * to external MF plugins via their `init(api)` export.
 *
 * `initDashboardPluginApi(api)` replays any queued calls from the pre-React
 * proxy on `window.__piDashboard` and replaces it with the live API.
 *
 * See change: runtime-plugin-loading (Decisions 2-4, spec: dashboard-plugin-api).
 */
import type { DashboardPluginApi, RuntimePluginClaim, ToastVariant } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/api.js";
import type { SlotRegistry, ClaimEntry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { SLOT_DEFINITIONS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import {
  registerToolRenderer,
  getToolRenderer,
  getToolHeaderChips,
  getToolSummary,
} from "../components/tool-renderers/registry.js";
import {
  getAllSessions,
  getSession,
  subscribeSessions,
} from "./session-store.js";
import {
  onPluginEvent,
  emitPluginEvent,
} from "./plugin-event-bus.js";
// Plugin config is stored in the runtime's module-level store, shared with
// usePluginConfig() consumers. We import directly from plugin-context.tsx
// (available via the runtime's "./context" subpath export) which is a pure
// data module — no React component imports, no circular dependency.
import {
  getPluginConfig,
  applyPluginConfigUpdate,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";

// ── Toast event bus (lightweight — a proper host UI is in PluginsSection) ────

type ToastListener = (toast: { message: string; variant: ToastVariant; id: number }) => void;
let nextToastId = 0;
const toastListeners = new Set<ToastListener>();

/** Subscribe to toast events. Returns unsubscribe. */
export function subscribeToasts(fn: ToastListener): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

function showToast(message: string, variant: ToastVariant = "info"): void {
  const toast = { message, variant, id: ++nextToastId };
  for (const fn of toastListeners) fn(toast);
}

// ── Dependencies passed to the factory ───────────────────────────────────────

export interface PluginApiDeps {
  /** The active SlotRegistry instance. */
  registry: SlotRegistry;
  /** WS send function (for setConfig persistence). */
  send: (msg: unknown) => void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a scoped DashboardPluginApi instance for a single plugin.
 * All registrations are tracked per-pluginId for bulk cleanup on unload.
 *
 * The returned `cleanup` array collects every unregister function; the
 * plugin loader (task 3) drains it when unloading a plugin.
 */
export function createDashboardPluginApi(
  deps: PluginApiDeps,
  pluginId: string,
  onCleanup: (fn: () => void) => void,
): DashboardPluginApi {
  const { registry, send } = deps;

  // ── registerClaim ──────────────────────────────────────────────────────

  function registerClaim(claim: RuntimePluginClaim): () => void {
    // Validate slot id
    const slotDef = SLOT_DEFINITIONS[claim.slot as keyof typeof SLOT_DEFINITIONS];
    if (!slotDef) {
      const valid = Object.keys(SLOT_DEFINITIONS).join(", ");
      throw new TypeError(
        `[${pluginId}] Invalid slot "${claim.slot}". Valid slots: ${valid}`,
      );
    }

    // Validate component presence for react slots
    if (slotDef.payloadTier !== "descriptor-only" && !claim.component) {
      throw new TypeError(
        `[${pluginId}] Slot "${claim.slot}" requires a React component (payloadTier: ${slotDef.payloadTier})`,
      );
    }

    // ── tool-renderer slot: delegate to registerToolRenderer ────────────
    if (claim.slot === "tool-renderer") {
      if (!claim.toolName) {
        throw new TypeError(
          `[${pluginId}] Slot "tool-renderer" requires a toolName`,
        );
      }

      // Save current state before overwriting
      const savedRenderer = getToolRenderer(claim.toolName);
      const savedChips = getToolHeaderChips(claim.toolName);
      const savedSummary = getToolSummary(claim.toolName);

      // Register plugin's renderer (for ToolCallStep via getToolRenderer)
      registerToolRenderer(claim.toolName, claim.component!, {
        headerChips: claim.headerChips as
          | import("../components/tool-renderers/types.js").HeaderChipsFn
          | undefined,
        summary: claim.summary,
      });

      // Also add a claim to the slot registry (for ToolRendererSlot consumer)
      const toolEntry: ClaimEntry = {
        pluginId,
        priority: 1000,
        slot: "tool-renderer",
        Component: claim.component,
        toolName: claim.toolName,
      };
      registry.addClaim(toolEntry);

      const cleanup = () => {
        // Restore saved state in tool-renderer registry
        registerToolRenderer(claim.toolName!, savedRenderer, {
          headerChips: savedChips,
          summary: savedSummary as (
            | ((args?: Record<string, unknown>) => string)
            | undefined
          ),
        });
        // Remove from slot registry
        registry.removeClaim(toolEntry);
      };
      onCleanup(cleanup);
      return cleanup;
    }

    // ── Other slots: add to registry ────────────────────────────────────

    const entry: ClaimEntry = {
      pluginId,
      priority: 1000, // external plugins default to 1000
      slot: claim.slot as ClaimEntry["slot"],
      componentName: claim.component?.displayName || claim.component?.name,
      Component: claim.component,
      command: claim.command as string | undefined,
      path: claim.path as string | undefined,
      sessionParam: claim.sessionParam as string | undefined,
      tab: claim.tab as string | undefined,
      toolName: claim.toolName,
      config: (claim.config as Record<string, unknown>) || undefined,
    };

    registry.addClaim(entry);

    const cleanup = () => {
      registry.removeClaim(entry);
    };
    onCleanup(cleanup);
    return cleanup;
  }

  // ── getConfig / setConfig ────────────────────────────────────────────

  const getConfig = () => getPluginConfig(pluginId) as Record<string, unknown>;

  const setConfig = async (partial: Record<string, unknown>) => {
    const current = getConfig();
    const merged = { ...current, ...partial };
    send({ type: "set_plugin_config", id: pluginId, config: merged });
    // Optimistically apply locally so usePluginConfig consumers see the update.
    applyPluginConfigUpdate({
      type: "plugin_config_update",
      id: pluginId,
      config: merged,
    } as Parameters<typeof applyPluginConfigUpdate>[0]);
  };

  // ── Assemble API object ───────────────────────────────────────────────

  const api: DashboardPluginApi = {
    pluginId,

    registerClaim,

    getSession,

    getAllSessions,

    subscribeSession: subscribeSessions,

    onEvent(type: string, fn: (event: unknown) => void): () => void {
      return onPluginEvent(type, fn);
    },

    showToast,

    getConfig<T extends Record<string, unknown> = Record<string, unknown>>(): T {
      return getConfig() as T;
    },

    async setConfig(partial: Record<string, unknown>): Promise<void> {
      return setConfig(partial);
    },

    /** Expose event emission for testing */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _emitEvent: (type: string, event: unknown) => {
      emitPluginEvent(type, event);
    },
  };

  return api;
}

// ── Browser-global wiring ────────────────────────────────────────────────────

/**
 * Replace the pre-React proxy on window.__piDashboard with the live API.
 * Replays any queued calls from before React mounted.
 *
 * Called from main.tsx after the SlotRegistry and WS are wired.
 */
export function initDashboardPluginApi(api: DashboardPluginApi): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy = (window as any).__piDashboard;
  if (proxy?.__isProxy && Array.isArray(proxy.__queue)) {
    for (const { method, args } of proxy.__queue) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api as any)[method](...args);
      } catch (e) {
        console.error(
          `[plugin-api] Error replaying queued call "${method}":`,
          e,
        );
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__piDashboard = api;
}
