/**
 * Client-side runtime plugin loader.
 *
 * On page load, fetches /api/plugins and loads every enabled plugin that
 * declares an mfRemote entry via script loading and the host's federation
 * runtime (registerRemotes / loadRemote). On `plugins_changed` WS events,
 * diffs against the loaded set and loads or unloads plugins dynamically —
 * no page refresh required.
 *
 * See change: runtime-plugin-loading (spec: runtime-plugin-contract).
 */
import type { SlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardPluginApi } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/api.js";
import { createDashboardPluginApi } from "./plugin-api.js";

// __webpack_require__ is a closure variable available in all
// rspack-compiled modules — used to access the federation runtime
// instance (__webpack_require__.federation.instance).
declare let __webpack_require__: Record<string, unknown> | undefined;

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal plugin shape from /api/plugins or plugins_changed broadcast. */
export interface RemotePluginInfo {
  id: string;
  enabled: boolean;
  mfRemote?: string;
  error?: string;
}

/** Per-plugin tracked state after a successful load. */
interface LoadedPlugin {
  id: string;
  cleanupFns: Array<() => void>;
}

// ── State ────────────────────────────────────────────────────────────────────

const loadedPlugins = new Map<string, LoadedPlugin>();

/** Callback invoked when load state changes (for UI reactivity). */
type LoadStateListener = () => void;
const loadStateListeners = new Set<LoadStateListener>();

// ── Dependencies (set by wirePluginLoader) ───────────────────────────────────

let _registry: SlotRegistry | null = null;
let _send: ((msg: unknown) => void) | null = null;

/** Wire the loader's dependencies. Called once from App.tsx after WS is ready. */
export function wirePluginLoader(deps: {
  registry: SlotRegistry;
  send: (msg: unknown) => void;
}): void {
  _registry = deps.registry;
  _send = deps.send;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to load-state changes (for UI reactivity). */
export function subscribeLoadState(fn: LoadStateListener): () => void {
  loadStateListeners.add(fn);
  return () => loadStateListeners.delete(fn);
}

/** Get IDs of all currently loaded remote plugins. */
export function getLoadedPluginIds(): string[] {
  return Array.from(loadedPlugins.keys());
}

/** Whether a specific plugin is currently loaded. */
export function isPluginLoaded(id: string): boolean {
  return loadedPlugins.has(id);
}

/**
 * Handle a plugin list change — either the initial page-load fetch or a
 * `plugins_changed` WS broadcast. Diffs against the currently loaded set
 * and loads newly enabled plugins / unloads removed ones.
 */
export async function handlePluginsChanged(plugins: RemotePluginInfo[]): Promise<void> {
  if (!_registry || !_send) {
    console.warn("[plugin-loader] Not wired yet — skipping handlePluginsChanged");
    return;
  }

  const currentIds = new Set(loadedPlugins.keys());
  const nextIds = new Set(
    plugins.filter((p) => p.enabled && p.mfRemote).map((p) => p.id),
  );

  // Unload removed/disabled plugins
  for (const id of currentIds) {
    if (!nextIds.has(id)) {
      await unloadPlugin(id);
    }
  }

  // Load newly enabled plugins
  const toLoad = plugins.filter(
    (p) => p.enabled && p.mfRemote && !currentIds.has(p.id),
  );

  for (const plugin of toLoad) {
    await loadRemotePlugin(plugin);
  }

  // Notify listeners
  for (const fn of loadStateListeners) fn();
}

// ── MF remote entry script loader ────────────────────────────────────────────

/**
 * Load a Module Federation remote entry as a <script> and return its
 * global variable name (the MF container name).  Rspack MF remote entries
 * are CJS-style scripts that set a global variable when loaded this way —
 * they cannot be loaded via native import().
 *
 * We take a snapshot of window keys before loading, then scan for new
 * keys containing init + get methods after the script fires to discover
 * the global name.
 */
async function loadRemoteScript(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const before = new Set(Object.keys(window));

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.type = "text/javascript";

    script.onload = () => {
      for (const key of Object.keys(window)) {
        if (before.has(key)) continue;
        try {
          const candidate = (window as unknown as Record<string, unknown>)[key];
          if (
            candidate &&
            typeof candidate === "object" &&
            typeof (candidate as Record<string, unknown>).init === "function" &&
            typeof (candidate as Record<string, unknown>).get === "function"
          ) {
            resolve(key);
            return;
          }
        } catch { /* inaccessible */ }
      }
      reject(
        new Error(
          `Remote entry loaded but no MF container found on window. ` +
            `New keys: ${Object.keys(window).filter((k) => !before.has(k)).join(", ") || "(none)"}`,
        ),
      );
    };

    script.onerror = () => {
      reject(new Error(`Failed to load remote script: ${url}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Load a single remote plugin via Module Federation.
 * Steps:
 *  1. Preflight HEAD to mfRemote URL
 *  2. Load remote entry as <script>, discover global container name
 *  3. Register the remote with the host's federation runtime
 *     (registerRemotes) so shared modules resolve correctly
 *  4. Load the remote module via the runtime (loadRemote), which
 *     internally handles container.init + container.get(".")
 *  5. Call module.init(api) to register claims
 *  6. Track cleanup functions
 */
async function loadRemotePlugin(plugin: RemotePluginInfo): Promise<void> {
  const mfRemote = plugin.mfRemote!;
  const pluginId = plugin.id;

  // 1. Preflight: HEAD to check remote availability
  try {
    const head = await fetch(mfRemote, { method: "HEAD" });
    if (!head.ok) {
      throw new Error(
        `Failed to load remote entry: ${head.status} ${head.statusText}`,
      );
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error preflighting remote";
    console.error(`[plugin-loader] ${pluginId}: ${msg}`);
    emitLoadError(pluginId, msg);
    return;
  }

  // 2. Load the MF remote entry as a <script>.  Rspack MF remote entries
  //    are CJS-style scripts that set a global container variable — they
  //    cannot be loaded via native import().  After loading, we use the
  //    host's federation runtime (registerRemotes + loadRemote) to
  //    properly negotiate shared modules (React, ReactDOM, etc.).
  let pluginModule: Record<string, unknown>;
  try {
    const globalName = await loadRemoteScript(mfRemote);

    // Register the remote with the host's federation runtime so it can
    // be loaded through the normal MF pipeline (with proper shared scope
    // negotiation).
    const fed = (
      typeof __webpack_require__ !== "undefined" ? __webpack_require__ : undefined
    ) as Record<string, unknown> | undefined;

    if (!fed?.federation) {
      throw new Error("Federation runtime not available — no __webpack_require__.federation");
    }

    const inst = (fed.federation as { instance?: Record<string, unknown> }).instance;
    if (!inst) {
      throw new Error("Federation runtime instance not initialised");
    }

    // registerRemotes (plural) is the public API on ModuleFederation.
    // registerRemote (singular) lives on RemoteHandler and is not
    // exposed on the instance — calling it was a silent no-op.
    (inst.registerRemotes as (r: unknown[], o: unknown) => void)?.(
      [{ name: globalName, entry: mfRemote, type: "global", entryGlobalName: globalName }],
      { force: true },
    );
    pluginModule = await (inst.loadRemote as (n: string) => Promise<Record<string, unknown>>)(globalName);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error importing remote";
    console.error(`[plugin-loader] ${pluginId}: ${msg}`);
    emitLoadError(pluginId, msg);
    return;
  }

  // 5. Create scoped API and call module.init(api)
  const cleanups: Array<() => void> = [];
  const onCleanup = (fn: () => void) => cleanups.push(fn);

  const api: DashboardPluginApi = createDashboardPluginApi(
    { registry: _registry!, send: _send! },
    pluginId,
    onCleanup,
  );

  try {
    if (typeof pluginModule.init !== "function") {
      throw new Error(
        `Remote module does not export an init(api) function. ` +
          `Exported keys: ${Object.keys(pluginModule).join(", ")}`,
      );
    }

    const cleanup = (
      pluginModule.init as (api: DashboardPluginApi) => void | (() => void)
    )(api);

    if (typeof cleanup === "function") {
      cleanups.push(cleanup);
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error in init(api)";
    console.error(`[plugin-loader] ${pluginId}: ${msg}`);

    // Clean up any partial registrations
    for (const fn of cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    _registry!.removeClaims(pluginId);
    emitLoadError(pluginId, msg);
    return;
  }

  // 6. Track loaded plugin
  loadedPlugins.set(pluginId, { id: pluginId, cleanupFns: cleanups });
  console.info(`[plugin-loader] ${pluginId}: loaded successfully`);
}

/**
 * Unload a previously loaded plugin.
 * Calls all cleanup functions, removes claims from the slot registry.
 * Idempotent — safe to call multiple times.
 */
export async function unloadPlugin(id: string): Promise<void> {
  const entry = loadedPlugins.get(id);
  if (!entry) return; // already unloaded

  console.info(`[plugin-loader] ${id}: unloading`);

  // Call all cleanup functions (including init() return value,
  // registerClaim unregisters, onEvent/subscribeSession unsubscribes)
  for (const fn of entry.cleanupFns) {
    try { fn(); } catch (e) {
      console.error(`[plugin-loader] ${id}: cleanup error:`, e);
    }
  }

  // Remove all claims from slot registry
  if (_registry) {
    _registry.removeClaims(id);
  }

  loadedPlugins.delete(id);
}

// ── Error surfacing ──────────────────────────────────────────────────────────

/**
 * Emit a load error. In the full implementation, this surfaces in
 * PluginStatusStore and <PluginsSection>. For now, we use a simple
 * window-level custom event that PluginsSection can listen for.
 */
function emitLoadError(pluginId: string, error: string): void {
  window.dispatchEvent(
    new CustomEvent("plugin-load-error", {
      detail: { pluginId, error },
    }),
  );
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Reset state for tests. */
export function __resetPluginLoaderForTests(): void {
  loadedPlugins.clear();
  loadStateListeners.clear();
  _registry = null;
  _send = null;
}
