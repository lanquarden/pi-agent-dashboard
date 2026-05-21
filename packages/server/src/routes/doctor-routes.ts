/**
 * GET /api/doctor — server-side diagnostic endpoint.
 *
 * Calls `runSharedChecks(...)` with server-appropriate `deps`, post-stamps
 * `section` + `suggestion`, returns `{ checks, summary, generatedAt }`.
 *
 * Auth-gated identically to `/api/config`; unauthenticated requests yield
 * the same status code as `/api/config` (the auth plugin's onRequest hook
 * intercepts before this handler runs).
 *
 * On a thrown error from `runSharedChecks`, returns a 200 with a single
 * fallback `error` row rather than a 500 — the web client always has
 * something to render. See change: doctor-rich-output (tasks 4.1–4.5).
 */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import {
  runSharedChecks,
  stampSectionsAndSuggestions,
  safeExec,
  type DoctorCheck,
  type DoctorReport,
  type SharedChecksDeps,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

function getManagedDir(): string {
  return process.env.MANAGED_DIR || path.join(os.homedir(), ".pi-dashboard");
}

function detectSystemNode(): { found: boolean; path?: string } {
  const cmd = process.platform === "win32" ? "where node" : "which node"; // platform-branch-ok: localised PATH-lookup primitive
  const r = safeExec(cmd, { timeoutMs: 3000 });
  if (!r.ok) return { found: false };
  const first = r.stdout.trim().split("\n")[0];
  return first ? { found: true, path: first } : { found: false };
}

function detectOnPath(name: string): { found: boolean; path?: string; source?: string } {
  const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`; // platform-branch-ok: localised PATH-lookup primitive
  const r = safeExec(cmd, { timeoutMs: 3000 });
  if (!r.ok) return { found: false };
  const first = r.stdout.trim().split("\n")[0];
  return first ? { found: true, path: first, source: "system" } : { found: false };
}

function isApiKeyConfigured(): boolean {
  try {
    const settings = path.join(os.homedir(), ".pi", "agent", "settings.json");
    if (!existsSync(settings)) return false;
    const data = JSON.parse(readFileSync(settings, "utf-8"));
    if (data?.anthropicApiKey || data?.openaiApiKey || data?.apiKey) return true;
    if (data?.providers && typeof data.providers === "object") {
      for (const v of Object.values(data.providers as Record<string, unknown>)) {
        if (v && typeof v === "object" && "apiKey" in (v as object)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function buildDefaultDeps(): SharedChecksDeps {
  return {
    managedDir: getManagedDir(),
    detectSystemNode,
    detectPi: () => detectOnPath("pi"),
    detectOpenSpec: () => detectOnPath("openspec"),
    isApiKeyConfigured,
    probeServer: async () => {
      // CRITICAL: do NOT shell out to `curl http://localhost:8000/api/health`
      // here. `safeExec` uses synchronous `execSync`, which blocks the Node
      // event loop until the child exits. The child is curl, talking back
      // to *this same Node process* — a self-deadlock. curl waits for the
      // server to respond, server is blocked in execSync, after 3 s the
      // timeout kills curl and the probe falsely reports "Not running".
      //
      // Since we are currently handling an HTTP request, by definition the
      // server IS running. Read process-resident health data directly
      // instead of round-tripping through HTTP.
      //
      // See change: harvest-bootstrap-survivor-fixes (cherry-pick 5).
      const installable =
        process.env.DASHBOARD_INSTALLABLE_TOTAL !== undefined
          ? {
              total: Number(process.env.DASHBOARD_INSTALLABLE_TOTAL ?? 0),
              installed: Number(process.env.DASHBOARD_INSTALLABLE_INSTALLED ?? 0),
              failed: [] as string[],
            }
          : null;
      return {
        running: true,
        starter: process.env.DASHBOARD_STARTER ?? null,
        mode: process.env.NODE_ENV === "development" ? "dev" : "production",
        installable,
      };
    },
  };
}

function summarize(checks: DoctorCheck[]): DoctorReport["summary"] {
  return {
    ok: checks.filter((c) => c.status === "ok").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    errors: checks.filter((c) => c.status === "error").length,
  };
}

export interface DoctorRouteDeps {
  /** Override for tests — substitutes a different `runSharedChecks` deps shape (or throws to exercise fault tolerance). */
  buildDeps?: () => SharedChecksDeps;
}

export function registerDoctorRoutes(fastify: FastifyInstance, deps: DoctorRouteDeps = {}): void {
  fastify.get("/api/doctor", async (_request, _reply): Promise<DoctorReport> => {
    try {
      const sharedDeps = deps.buildDeps ? deps.buildDeps() : buildDefaultDeps();
      const checks = await runSharedChecks(sharedDeps);
      stampSectionsAndSuggestions(checks);
      return {
        checks,
        summary: summarize(checks),
        generatedAt: Date.now(),
      };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const fallback: DoctorCheck = {
        name: "Doctor failed to produce a report",
        section: "diagnostics",
        status: "error",
        message: "Unexpected internal failure",
        detail: `${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`,
        suggestion:
          "Check `~/.pi-dashboard/doctor.log` on the server, then file an issue with the captured error.",
      };
      return {
        checks: [fallback],
        summary: { ok: 0, warnings: 0, errors: 1 },
        generatedAt: Date.now(),
      };
    }
  });
}
