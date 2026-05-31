/**
 * DashboardPluginApi — the typed API surface exposed to external MF plugins
 * via their `init(api)` export.
 *
 * Mirrors methods available on `window.__piDashboard` after React mounts.
 * See change: runtime-plugin-loading (Decision 4).
 */
import type { DashboardSession } from "../types.js";

export type ToastVariant = "info" | "success" | "warning" | "error";

/**
 * A slot claim registered at runtime (component is a resolved React component,
 * not a string name from the manifest).
 */
export interface RuntimePluginClaim {
  /** Target slot id (must be in SLOT_DEFINITIONS). */
  slot: string;
  /** Resolved React component (required for react-only / react-or-descriptor slots). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: React.ComponentType<any>;
  /** Tool name (required for "tool-renderer" slot). */
  toolName?: string;
  /**
   * Header chips function for tool-renderer claims.
   * Passed through to registerToolRenderer opts.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headerChips?: (...args: any[]) => any;
  /**
   * Summary override function for tool-renderer claims.
   * Passed through to registerToolRenderer opts.
   */
  summary?: (args?: Record<string, unknown>) => string;
  /** Slot-specific extra fields (command, path, tab, etc.). */
  [key: string]: unknown;
}

/**
 * Typed API surface for dashboard plugins.
 *
 * Every registration method returns an unregister function.
 * Plugin-scoped: all operations are implicitly scoped to the calling plugin's id.
 */
export interface DashboardPluginApi {
  /** Globally unique plugin id (read-only). */
  readonly pluginId: string;

  /**
   * Register a slot claim at runtime.
   * For tool-renderer claims, delegates to registerToolRenderer internally.
   * Returns an unregister function.
   */
  registerClaim(claim: RuntimePluginClaim): () => void;

  /** Get a single session by id (or undefined if not found). */
  getSession(id: string): DashboardSession | undefined;

  /** Get all known sessions as an array. */
  getAllSessions(): DashboardSession[];

  /**
   * Subscribe to session list changes.
   * Callback receives the full current session list on every change.
   * Returns an unsubscribe function.
   */
  subscribeSession(fn: (sessions: DashboardSession[]) => void): () => void;

  /**
   * Subscribe to WebSocket events by type string.
   * The callback receives the full parsed ServerToBrowserMessage.
   * Returns an unsubscribe function.
   */
  onEvent(type: string, fn: (event: unknown) => void): () => void;

  /**
   * Show a transient toast notification in the dashboard UI.
   */
  showToast(message: string, variant?: ToastVariant): void;

  /**
   * Read the current plugin-scoped config (in-memory).
   * Returns {} before any config has been received from the server.
   */
  getConfig<T extends Record<string, unknown> = Record<string, unknown>>(): T;

  /**
   * Write plugin-scoped config (merged with existing).
   * Sends a `set_plugin_config` message over the WebSocket.
   * Returns a promise that resolves after the message is queued.
   */
  setConfig(partial: Record<string, unknown>): Promise<void>;

  /**
   * Internal test helper — emit an event into the plugin event bus.
   * Not part of the public plugin API surface.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _emitEvent(type: string, event: unknown): void;
}
