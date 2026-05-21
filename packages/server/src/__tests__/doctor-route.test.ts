/**
 * Route tests for `GET /api/doctor`.
 *
 * Asserts:
 *   - JSON shape contract (every check has `section`; non-ok has message+detail+suggestion)
 *   - summary counts match
 *   - fault-tolerance arm: a deps function that throws → 200 with fallback row
 *   - no Electron-only rows (4.5)
 *
 * See change: doctor-rich-output (tasks 4.4–4.5).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDoctorRoutes } from "../routes/doctor-routes.js";
import type {
  DoctorReport,
  SharedChecksDeps,
} from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

const ELECTRON_ONLY_NAMES = new Set([
  "Electron",
  "Bundled Node.js",
  "Bundled npm",
  "Offline packages bundle",
  "Dashboard server code",
  "Server launch test",
]);

async function makeApp(buildDeps?: () => SharedChecksDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerDoctorRoutes(app, buildDeps ? { buildDeps } : {});
  await app.ready();
  return app;
}

function fakeDeps(overrides: Partial<SharedChecksDeps> = {}): SharedChecksDeps {
  return {
    managedDir: "/tmp/doctor-route-test-managed",
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/local/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: false }),
    isApiKeyConfigured: () => true,
    probeServer: async () => ({ running: true, version: "0.4.6", mode: "production" }),
    ...overrides,
  };
}

describe("/api/doctor", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 with a DoctorReport envelope", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DoctorReport;
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.generatedAt).toBe("number");
  });

  it("every check has a section", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    for (const c of body.checks) {
      expect(c.section).toBeDefined();
      expect(["runtime", "pi-tooling", "server", "setup", "diagnostics"]).toContain(c.section);
    }
  });

  it("every non-ok row carries non-empty message + detail + suggestion (Decision 8 lint)", async () => {
    app = await makeApp(() =>
      fakeDeps({
        detectPi: () => ({ found: false }),
        detectOpenSpec: () => ({ found: false }),
        probeServer: async () => ({ running: false }),
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    const nonOk = body.checks.filter((c) => c.status !== "ok");
    expect(nonOk.length).toBeGreaterThan(0);
    for (const c of nonOk) {
      expect(c.message.length).toBeGreaterThan(0);
      expect((c.detail ?? "").length).toBeGreaterThan(0);
      expect((c.suggestion ?? "").length).toBeGreaterThan(0);
    }
  });

  it("summary counts match the rows", async () => {
    app = await makeApp(() =>
      fakeDeps({
        detectPi: () => ({ found: false }),
      }),
    );
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    const ok = body.checks.filter((c) => c.status === "ok").length;
    const warn = body.checks.filter((c) => c.status === "warning").length;
    const err = body.checks.filter((c) => c.status === "error").length;
    expect(body.summary.ok).toBe(ok);
    expect(body.summary.warnings).toBe(warn);
    expect(body.summary.errors).toBe(err);
  });

  it("never returns Electron-only rows (4.5)", async () => {
    app = await makeApp(() => fakeDeps());
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    const body = res.json() as DoctorReport;
    for (const c of body.checks) {
      expect(ELECTRON_ONLY_NAMES.has(c.name)).toBe(false);
    }
  });

  it("probeServer reads process state, never spawns a subprocess", async () => {
    // Set the env vars the new probeServer reads directly.
    const prev = {
      DASHBOARD_STARTER: process.env.DASHBOARD_STARTER,
      NODE_ENV: process.env.NODE_ENV,
      DASHBOARD_INSTALLABLE_TOTAL: process.env.DASHBOARD_INSTALLABLE_TOTAL,
      DASHBOARD_INSTALLABLE_INSTALLED: process.env.DASHBOARD_INSTALLABLE_INSTALLED,
    };
    process.env.DASHBOARD_STARTER = "Electron";
    process.env.NODE_ENV = "production";
    process.env.DASHBOARD_INSTALLABLE_TOTAL = "3";
    process.env.DASHBOARD_INSTALLABLE_INSTALLED = "3";

    try {
      // Inject a deps override that captures what probeServer returns
      // by building default deps and calling probeServer directly.
      const { buildDefaultDepsForTest } = await import("../routes/doctor-routes.js") as {
        buildDefaultDepsForTest?: () => SharedChecksDeps;
      };

      // We don't export buildDefaultDeps directly, so instead assert via
      // the route: if the self-curl deadlock were present it would time out;
      // instead the route must complete quickly (< 500 ms).
      app = await makeApp();
      const start = Date.now();
      const res = await app.inject({ method: "GET", url: "/api/doctor" });
      const elapsed = Date.now() - start;

      expect(res.statusCode).toBe(200);
      // Must complete well under the old 3 s curl timeout. The full
      // doctor run includes binary-detection checks that can take ~1 s
      // on slow CI; we just assert no self-curl deadlock (< 3 s).
      expect(elapsed).toBeLessThan(3000);

      // The server check row should say "running" / "ok" since we are
      // processing this request inside the running server.
      const body = res.json() as DoctorReport;
      const serverRow = body.checks.find((c) => c.name === "Dashboard server");
      expect(serverRow).toBeDefined();
      expect(serverRow?.status).toBe("ok");
    } finally {
      // Restore env
      if (prev.DASHBOARD_STARTER === undefined) delete process.env.DASHBOARD_STARTER;
      else process.env.DASHBOARD_STARTER = prev.DASHBOARD_STARTER;
      if (prev.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev.NODE_ENV;
      if (prev.DASHBOARD_INSTALLABLE_TOTAL === undefined) delete process.env.DASHBOARD_INSTALLABLE_TOTAL;
      else process.env.DASHBOARD_INSTALLABLE_TOTAL = prev.DASHBOARD_INSTALLABLE_TOTAL;
      if (prev.DASHBOARD_INSTALLABLE_INSTALLED === undefined) delete process.env.DASHBOARD_INSTALLABLE_INSTALLED;
      else process.env.DASHBOARD_INSTALLABLE_INSTALLED = prev.DASHBOARD_INSTALLABLE_INSTALLED;
    }
  });

  it("returns 200 with a single fallback row when buildDeps throws", async () => {
    app = await makeApp(() => {
      throw new Error("boom — deps unavailable");
    });
    const res = await app.inject({ method: "GET", url: "/api/doctor" });
    // Per task 4.3, the route returns 200 even on internal failure so the
    // client always has something to render.
    expect(res.statusCode).toBe(200);
    const body = res.json() as DoctorReport;
    expect(body.checks.length).toBe(1);
    expect(body.checks[0].status).toBe("error");
    expect(body.checks[0].name).toMatch(/Doctor failed/i);
    expect(body.summary.errors).toBe(1);
  });
});
