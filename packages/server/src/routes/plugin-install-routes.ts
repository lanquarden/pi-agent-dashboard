/**
 * Plugin install / uninstall / search routes.
 *
 * POST /api/plugins/install { source: "npm:<pkg>" } — download npm tarball,
 *   extract to ~/.pi/dashboard/plugins/<id>/, read manifest, broadcast
 *   plugins_changed.
 * POST /api/plugins/uninstall/:id — remove plugin directory, broadcast
 *   plugins_changed.
 * GET /api/plugins/available?q=<search> — search npm for
 *   pi-dashboard-plugin keyword.
 *
 * See change: runtime-plugin-loading (spec: plugin-install).
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execSync, spawnSync } from "node:child_process"; // ban:child_process-ok — npm install orchestrator
import type { NetworkGuard } from "./route-deps.js";
import type { PluginManifest } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import {
  discoverPlugins,
  getPluginStatusStore,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(os.homedir(), ".pi", "dashboard", "plugins");

function ensurePluginsDir(): string {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  return PLUGINS_DIR;
}

// ── npm helpers ──────────────────────────────────────────────────────────────

interface NpmPackageInfo {
  name: string;
  "dist-tags": { latest: string };
  versions: Record<string, { dist: { tarball: string } }>;
}

async function fetchNpmPackageInfo(pkgName: string): Promise<NpmPackageInfo> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Package "${pkgName}" not found on npm`);
    throw new Error(`npm registry returned ${res.status}`);
  }
  return (await res.json()) as NpmPackageInfo;
}

async function downloadAndExtractTarball(
  tarballUrl: string,
  destDir: string,
): Promise<void> {
  const res = await fetch(tarballUrl);
  if (!res.ok) throw new Error(`Failed to download tarball: ${res.status}`);

  // Write to a temp file, then extract
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-dashboard-plugin-"),
  );
  const tgzPath = path.join(tmpDir, "package.tgz");

  try {
    // Download tarball
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tgzPath, buf);

    // Create destination directory
    fs.mkdirSync(destDir, { recursive: true });

    // Extract tarball using `tar` CLI (available on all supported platforms).
    // npm tarballs contain a top-level "package/" directory.
    const result = spawnSync("tar", ["-xzf", tgzPath, "-C", destDir, "--strip-components=1"], {
      stdio: "pipe",
      timeout: 30_000,
    });

    if (result.status !== 0) {
      const stderr = result.stderr.toString();
      throw new Error(`tar extract failed: ${stderr || "unknown error"}`);
    }
  } finally {
    // Clean up temp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export function registerPluginInstallRoutes(
  fastify: FastifyInstance,
  deps: {
    networkGuard: NetworkGuard;
    broadcast: (msg: ServerToBrowserMessage) => void;
    repoRoot?: string;
  },
): void {
  const { networkGuard, broadcast, repoRoot } = deps;

  // ── GET /api/plugins/available ──────────────────────────────────────────

  fastify.get(
    "/api/plugins/available",
    { preHandler: networkGuard },
    async (request, reply) => {
      const query = (request.query as Record<string, string> | undefined)?.q ?? "";
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(
        `keywords:pi-dashboard-plugin ${query}`,
      )}&size=50`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          return reply
            .status(502)
            .send({ success: false, error: `npm search failed: ${res.status}` });
        }

        const json = (await res.json()) as {
          objects: Array<{
            package: {
              name: string;
              description?: string;
              version: string;
              keywords?: string[];
              date: string;
              links?: Record<string, string>;
            };
          }>;
        };

        const packages = (json.objects ?? []).map((obj) => ({
          name: obj.package.name,
          description: obj.package.description ?? "",
          version: obj.package.version,
          date: obj.package.date,
          links: obj.package.links ?? {},
        }));

        return reply.status(200).send({ success: true, packages });
      } catch (err) {
        return reply
          .status(500)
          .send({ success: false, error: String(err) });
      }
    },
  );

  // ── POST /api/plugins/install ───────────────────────────────────────────

  fastify.post<{ Body: { source: string } }>(
    "/api/plugins/install",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const source = body.source;

      if (!source || typeof source !== "string") {
        return reply
          .status(400)
          .send({ success: false, error: "body.source must be a string (e.g. 'npm:<pkg>')" });
      }

      if (!source.startsWith("npm:")) {
        return reply
          .status(400)
          .send({ success: false, error: 'Only "npm:<pkg>" sources are supported' });
      }

      const pkgName = source.slice("npm:".length).trim();
      if (!pkgName) {
        return reply
          .status(400)
          .send({ success: false, error: "Package name is empty" });
      }

      // Validate package name
      if (!/^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(pkgName)) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid package name" });
      }

      try {
        // Fetch package info from npm
        const info = await fetchNpmPackageInfo(pkgName);
        const latestVersion = info["dist-tags"]?.latest;
        if (!latestVersion || !info.versions?.[latestVersion]) {
          return reply
            .status(404)
            .send({ success: false, error: "Package has no published versions" });
        }

        const tarballUrl = info.versions[latestVersion].dist.tarball;
        if (!tarballUrl) {
          return reply
            .status(500)
            .send({ success: false, error: "No tarball URL found" });
        }

        // Derive plugin id from package name
        // Strip scope (@scope/) and convert to kebab-case-like id
        const pluginId = pkgName.replace(/^@[^/]+\//, "");

        const pluginDir = path.join(ensurePluginsDir(), pluginId);

        // Download and extract
        await downloadAndExtractTarball(tarballUrl, pluginDir);

        // Read manifest from extracted files
        let manifest: PluginManifest | null = null;
        const manifestPaths = [
          path.join(pluginDir, "dashboard-plugin.json"),
          path.join(pluginDir, "package", "dashboard-plugin.json"),
        ];

        for (const mp of manifestPaths) {
          try {
            const raw = fs.readFileSync(mp, "utf-8");
            const parsed = JSON.parse(raw) as PluginManifest;
            if (parsed.id && Array.isArray(parsed.claims)) {
              manifest = parsed;
              break;
            }
          } catch {
            // Continue to next path
          }
        }

        if (!manifest) {
          // Clean up on missing manifest
          try { fs.rmSync(pluginDir, { recursive: true, force: true }); } catch { /* ignore */ }
          return reply
            .status(400)
            .send({ success: false, error: "Plugin tarball does not contain a valid dashboard-plugin.json manifest" });
        }

        // Update PluginStatusStore and broadcast plugins_changed
        const store = getPluginStatusStore();
        store.setStatus({
          id: pluginId,
          displayName: manifest.displayName || pluginId,
          enabled: true,
          loaded: true,
          claims: manifest.claims.length,
          source: "dashboard-installed",
          mfRemote: manifest.mfRemote
            ? `/plugins/${pluginId}/${manifest.mfRemote.replace(/^\.\//, "")}`
            : undefined,
        });

        // Re-discover plugins and broadcast
        const allPlugins = discoverPlugins(repoRoot);
        const allStatus = store.listAll();

        broadcast({
          type: "plugins_changed",
          plugins: allStatus.map((s) => ({
            id: s.id,
            displayName: s.displayName,
            enabled: s.enabled,
            loaded: s.loaded,
            error: s.error,
            source: s.source,
            mfRemote: s.mfRemote,
          })),
        });

        return reply.status(200).send({
          success: true,
          plugin: { id: pluginId, displayName: manifest.displayName },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[plugin-install] Failed to install "${pkgName}":`, msg);
        return reply
          .status(500)
          .send({ success: false, error: msg });
      }
    },
  );

  // ── POST /api/plugins/uninstall/:id ─────────────────────────────────────

  fastify.post<{ Params: { id: string } }>(
    "/api/plugins/uninstall/:id",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { id } = request.params;

      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
        return reply
          .status(400)
          .send({ success: false, error: "Invalid plugin id" });
      }

      const pluginDir = path.join(PLUGINS_DIR, id);

      if (!fs.existsSync(pluginDir)) {
        return reply
          .status(404)
          .send({ success: false, error: "Plugin not found" });
      }

      try {
        fs.rmSync(pluginDir, { recursive: true, force: true });

        // Update PluginStatusStore
        const store = getPluginStatusStore();
        store.setStatus({
          id,
          displayName: id,
          enabled: false,
          loaded: false,
          claims: 0,
          source: "dashboard-installed",
        });

        // Broadcast plugins_changed
        const allStatus = store.listAll();
        broadcast({
          type: "plugins_changed",
          plugins: allStatus.map((s) => ({
            id: s.id,
            displayName: s.displayName,
            enabled: s.enabled,
            loaded: s.loaded,
            error: s.error,
            source: s.source,
            mfRemote: s.mfRemote,
          })),
        });

        return reply.status(200).send({ success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[plugin-install] Failed to uninstall "${id}":`, msg);
        return reply
          .status(500)
          .send({ success: false, error: msg });
      }
    },
  );
}
