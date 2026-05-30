/**
 * Plugin bundle serving routes.
 *
 * GET /plugins/:id/* — serves pre-built plugin bundles from
 * ~/.pi/dashboard/plugins/<id>/. Gated by localhostGuard.
 *
 * Supports a dev override via PI_DASHBOARD_PLUGIN_DEV env var
 * (JSON map of plugin id → dev server URL) to proxy to a running
 * plugin dev server (e.g. Rspack dev server).
 *
 * See change: runtime-plugin-loading (spec: external-plugin-serving).
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { NetworkGuard } from "./route-deps.js";

// ── MIME types by extension ──────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
};

/** Filename pattern for hashed/immutable assets (e.g. main.abc123.js). */
const HASHED_FILENAME_RE = /\.[0-9a-f]{8,}\.(js|css|woff2?)$/i;

// ── Dev override ─────────────────────────────────────────────────────────────

interface DevOverride {
  [pluginId: string]: string; // dev server URL
}

let _devOverride: DevOverride | null = null;
let _devOverrideLoaded = false;

function loadDevOverride(): DevOverride | null {
  if (_devOverrideLoaded) return _devOverride;
  _devOverrideLoaded = true;
  try {
    const raw = process.env.PI_DASHBOARD_PLUGIN_DEV;
    if (!raw) return null;
    _devOverride = JSON.parse(raw) as DevOverride;
    return _devOverride;
  } catch {
    console.warn(
      "[plugin-bundle-routes] PI_DASHBOARD_PLUGIN_DEV is not valid JSON, ignoring",
    );
    return null;
  }
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerPluginBundleRoutes(
  fastify: FastifyInstance,
  deps: { networkGuard: NetworkGuard },
): void {
  const { networkGuard } = deps;

  fastify.get<{ Params: { id: string; "*": string } }>(
    "/plugins/:id/*",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { id } = request.params;
      const wildcardPath = request.params["*"] ?? "";

      // Validate plugin id: only allow safe path characters
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
        return reply
          .status(400)
          .send({ error: "Invalid plugin id" });
      }

      // Check dev override
      const devOverride = loadDevOverride();
      if (devOverride?.[id]) {
        const devUrl = devOverride[id].replace(/\/$/, "");
        const targetUrl = `${devUrl}/${wildcardPath}`;

        try {
          const proxyRes = await fetch(targetUrl, { method: "GET" });
          if (proxyRes.ok) {
            const buf = await proxyRes.arrayBuffer();
            const ext = path.extname(wildcardPath).toLowerCase();
            const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
            void reply
              .header("Content-Type", contentType)
              // Dev responses are never cached
              .header("Cache-Control", "no-store")
              .send(Buffer.from(buf));
            return;
          }
          // Dev server unreachable or returned error — fall through to disk
          console.warn(
            `[plugin-bundle-routes] Dev override for "${id}" returned ${proxyRes.status}, falling back to disk`,
          );
        } catch {
          console.warn(
            `[plugin-bundle-routes] Dev override for "${id}" unreachable (${devUrl}), falling back to disk`,
          );
        }
      }

      // Resolve plugin directory
      const pluginDir = path.join(
        os.homedir(),
        ".pi",
        "dashboard",
        "plugins",
        id,
      );

      if (!fs.existsSync(pluginDir)) {
        return reply
          .status(404)
          .send({ error: "Plugin not found" });
      }

      // Resolve the requested file path
      const filePath = path.resolve(pluginDir, wildcardPath);

      // 🔒 Path traversal guard: ensure resolved path stays inside pluginDir
      if (!filePath.startsWith(pluginDir + path.sep) && filePath !== pluginDir) {
        return reply
          .status(403)
          .send({ error: "Forbidden" });
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return reply
          .status(404)
          .send({ error: "File not found" });
      }

      // Determine MIME type
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      // Cache strategy: hashed filenames get immutable cache,
      // non-hashed (e.g. remoteEntry.js) get short TTL
      const isHashed = HASHED_FILENAME_RE.test(path.basename(filePath));
      const cacheControl = isHashed
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60";

      const stat = fs.statSync(filePath);
      void reply
        .header("Content-Type", contentType)
        .header("Cache-Control", cacheControl)
        .header("Content-Length", stat.size)
        .send(fs.createReadStream(filePath));
    },
  );
}
