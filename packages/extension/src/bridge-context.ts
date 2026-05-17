/**
 * Shared mutable state for bridge modules.
 * Avoids passing 14+ closure variables to every extracted function.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ConnectionManager } from "./connection.js";

export interface BridgeContext {
  pi: ExtensionAPI;
  connection: ConnectionManager;
  /** Current session ID (mutated on session change: new/fork/resume) */
  sessionId: string;
  cachedCtx: any;
  cachedModelRegistry: any;
  cachedHasUI: boolean | undefined;
  lastModel: string | undefined;
  lastThinkingLevel: string | undefined;
  lastSessionFile: string | undefined;
  lastSessionDir: string | undefined;
  lastFirstMessage: string | undefined;
  lastGitBranch: string | undefined;
  lastGitPrNumber: number | undefined;
  /**
   * Last serialized `JjState` snapshot sent to the server, or `null`
   * when the previous probe explicitly cleared it. Compared on every
   * probe tick so we only send `jj_state_update` when the value actually
   * changes. See change: add-jj-workspace-plugin.
   */
  lastJjStateJson: string | undefined;
  lastSessionName: string | undefined;
  /**
   * `false` until the very first `sendStateSync` after the bridge
   * process boots; `true` for the rest of the process lifetime.
   * Drives `registerReason` on `session_register` so the server can
   * distinguish initial spawn vs. dashboard-restart reattach.
   * `handleSessionChange` (new/fork/resume) ignores this flag and
   * always tags `"spawn"` because it mints a fresh sessionId.
   * See change: reattach-move-to-front.
   */
  hasRegisteredOnce: boolean;
}

// Commands that the dashboard handles natively with superior UX, filtered from
// the command list sent to dashboard clients AND from extension-slash detection.
// Current set: { "roles" }. Bridge-registered `__dashboard_reload` is filtered
// separately by the `__`-prefix rule. See change: fix-extension-slash-commands-in-dashboard.
export const DASHBOARD_NATIVE_COMMANDS = new Set(["roles"]);

/** Filter out hidden commands (names starting with __) and dashboard-native commands from commands list */
export function filterHiddenCommands(commands: any[]): any[] {
  return commands.filter((cmd) =>
    !cmd.name.startsWith("__") &&
    !DASHBOARD_NATIVE_COMMANDS.has(cmd.name)
  );
}

/**
 * Pure predicate: does `text` name an extension-registered slash command?
 *
 * Returns true iff:
 *   - `text` starts with `/` and contains no embedded newline
 *   - the token after `/` (up to first space or end) appears in `commandList`
 *     with `source === "extension"`
 *   - that token is NOT in `DASHBOARD_NATIVE_COMMANDS` (and not `__`-prefixed)
 *
 * Pure: no pi calls, no mutation. See change: fix-extension-slash-commands-in-dashboard.
 */
export function isExtensionSlashCommand(
  text: string,
  commandList: ReadonlyArray<{ name: string; source?: string }>,
): boolean {
  if (typeof text !== "string" || !text.startsWith("/")) return false;
  if (text.includes("\n")) return false;
  const rest = text.slice(1);
  const spaceIdx = rest.indexOf(" ");
  const cmdName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  if (!cmdName) return false;
  if (cmdName.startsWith("__")) return false;
  if (DASHBOARD_NATIVE_COMMANDS.has(cmdName)) return false;
  return commandList.some((c) => c?.name === cmdName && c?.source === "extension");
}

/**
 * Feature-detect upstream `pi.dispatchCommand(text, opts)` (pi 0.71+).
 * Returns true iff the field is a function on the supplied object.
 *
 * Uses both `typeof` (which traverses the prototype chain) and `in` (which
 * catches properties defined via getters / Proxy traps that `typeof` alone
 * might miss). The double-check avoids false negatives when pi wraps
 * dispatchCommand behind a Proxy or a getter.
 * See change: fix-extension-slash-commands-in-dashboard,
 *             fix-slash-dispatch-delivery.
 */
export function hasDispatchCommand(pi: unknown): boolean {
  if (pi == null) return false;
  const piAny = pi as any;
  // Standard typeof check (works for own + prototype methods).
  if (typeof piAny.dispatchCommand === "function") return true;
  // Fallback: check with `in` operator for getter-backed / Proxy-hidden
  // properties that `typeof` alone might not resolve.
  if ("dispatchCommand" in piAny) {
    try {
      const val = piAny.dispatchCommand;
      if (typeof val === "function") return true;
    } catch {
      // Getter threw — not usable.
    }
  }
  return false;
}

/**
 * Pure predicate: is this bridge running inside a dashboard-spawned
 * headless `pi --mode rpc` session?
 *
 * Both probes MUST be true:
 *  1. `process.env.PI_DASHBOARD_SPAWNED === "1"` (set by
 *     `process-manager.ts::buildSpawnEnv` for every dashboard-spawned session).
 *  2. `process.argv` contains `--mode` adjacent to `rpc`.
 *
 * Either alone is insufficient: env-only matches dashboard-spawned tmux
 * sessions; argv-only matches non-dashboard RPC invocations.
 *
 * Optional `env` / `argv` parameters exist purely for unit testing
 * (defaulting to the live process state). See change:
 * add-rpc-stdin-dispatch-with-keeper-sidecar (task 7.1).
 */
export function isHeadlessRpcSession(
  env: NodeJS.ProcessEnv = process.env,
  argv: ReadonlyArray<string> = process.argv,
): boolean {
  if (env.PI_DASHBOARD_SPAWNED !== "1") return false;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "--mode" && argv[i + 1] === "rpc") return true;
  }
  return false;
}

/** Extract first user message text from session entries */
export function extractFirstMessage(ctx: any): string | undefined {
  try {
    const entries = ctx?.sessionManager?.getEntries?.();
    if (!entries || !Array.isArray(entries)) return undefined;
    for (const entry of entries) {
      if (entry.role === "user" && typeof entry.content === "string") {
        return entry.content.slice(0, 200);
      }
      if (entry.role === "user" && Array.isArray(entry.content)) {
        for (const part of entry.content) {
          if (part.type === "text" && typeof part.text === "string") {
            return part.text.slice(0, 200);
          }
        }
      }
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Get current model string (provider/id) from cached context */
export function getCurrentModelString(bc: BridgeContext): string | undefined {
  const model = bc.cachedCtx?.model;
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}
