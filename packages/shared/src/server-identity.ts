/**
 * Server identity verification via HTTP health check.
 * Replaces bare TCP port probes with identity-verified dashboard detection.
 *
 * Retry semantics (cherry-pick 2 of harvest-bootstrap-survivor-fixes):
 * the pre-wizard probe in Electron's main process fires while a *previous*
 * server instance may still be mid-bootstrap (jiti TypeScript transpile +
 * cold-cache extraction can block the event loop for 5–15 s). The default
 * 2 s timeout + 1 attempt produces false negatives in that window.
 * Callers can opt into a bounded retry loop via `opts.retries` /
 * `opts.timeoutMs` / `opts.retryDelayMs`. Defaults preserve legacy
 * behaviour (single attempt, 2 s timeout) so existing call sites are
 * unaffected.
 */

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 500;

export interface DashboardStatus {
  /** Whether the dashboard server is running on this port */
  running: boolean;
  /** PID of the running server (if detected) */
  pid?: number;
  /** Server version from /api/health (when detected) */
  version?: string;
  /** Port is occupied by a non-dashboard service */
  portConflict?: boolean;
}

export interface DashboardCheckOpts {
  /**
   * Per-attempt fetch timeout. Default 2000 ms — preserves legacy single-shot behaviour.
   * Bootstrap-aware callers should pass ~8000 ms to absorb event-loop hiccups
   * during cold-cache install.
   */
  timeoutMs?: number;
  /**
   * Number of additional attempts after the first. Default 0 (no retries).
   * On `AbortError` (timeout) or 5xx the loop sleeps `retryDelayMs` and
   * retries. `portConflict: true` (HTTP 200 with foreign JSON shape)
   * short-circuits — that's a deterministic conflict, not a transient
   * fault, and retrying would mask a real port collision.
   * ECONNREFUSED is *not* retried (no process to talk to).
   */
  retries?: number;
  /** Sleep between retries. Default 500 ms. */
  retryDelayMs?: number;
  /**
   * Test seam: replace `setTimeout`-based sleep. Receives the configured
   * `retryDelayMs`. Must return a promise that resolves after the sleep.
   */
  _sleep?: (ms: number) => Promise<void>;
}

/**
 * Check if a dashboard server is running on the given port by hitting GET /api/health.
 * Returns identity-verified status instead of just "port is open".
 */
export async function isDashboardRunning(
  port: number,
  host: string = "localhost",
  opts?: DashboardCheckOpts,
): Promise<DashboardStatus> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = opts?._sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const attempts = retries + 1;
  let lastResult: DashboardStatus = { running: false };

  for (let i = 0; i < attempts; i++) {
    const result = await probeOnce(port, host, timeoutMs);
    // Success — return immediately.
    if (result.running) return result;
    // Deterministic conflict — short-circuit (retrying would mask it).
    if (result.portConflict) return result;
    lastResult = result;
    if (i < attempts - 1) await sleep(retryDelayMs);
  }
  return lastResult;
}

async function probeOnce(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<DashboardStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`http://${host}:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { running: false, portConflict: true };
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (data && data.ok === true && typeof data.pid === "number") {
      const version = typeof data.version === "string" ? data.version : undefined;
      return { running: true, pid: data.pid, version };
    }

    // HTTP 200 but not our format — another service
    return { running: false, portConflict: true };
  } catch (err: unknown) {
    clearTimeout(timer);
    // Connection refused or timeout — nothing running
    if (err instanceof Error && err.name === "AbortError") {
      return { running: false };
    }
    // Could be ECONNREFUSED or other network error
    return { running: false };
  }
}
