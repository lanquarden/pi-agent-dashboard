/**
 * Shared build configuration for both Vite (dev) and Rspack (production).
 *
 * See change: runtime-plugin-loading (Decision 1 — Rspack host + Vite dev).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Aliases shared by Vite and Rspack configs. */
export const aliases: Record<string, string> = {
  "@blackbelt-technology/pi-dashboard-shared": path.resolve(
    __dirname,
    "../shared/src",
  ),
  "@blackbelt-technology/pi-dashboard-client-utils": path.resolve(
    __dirname,
    "../client-utils/src",
  ),
};

/** File extensions resolved by both bundlers. */
export const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

/** Env defines for production builds. */
export const defines: Record<string, string> = {
  "process.env.NODE_ENV": JSON.stringify(
    process.env.NODE_ENV || "production",
  ),
};
