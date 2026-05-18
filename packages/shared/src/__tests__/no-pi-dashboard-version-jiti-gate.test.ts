/**
 * Repo-lint: `packages/server/bin/pi-dashboard.mjs` MUST check
 * `process.argv` for `--version` / `-v` / `version` BEFORE invoking any
 * jiti resolution helper. Guards against regression of Bug B.
 *
 * See change: fix-electron-cold-launch-probe-cascade.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "server",
  "bin",
  "pi-dashboard.mjs",
);

describe("pi-dashboard.mjs — --version short-circuit before jiti (Bug B regression guard)", () => {
  it("checks argv for --version/-v/version BEFORE calling resolveJitiUrl()", () => {
    const src = fs.readFileSync(wrapperPath, "utf-8");

    const versionRegex = /process\.argv\[2\]|--version|"version"|"-v"/;
    const jitiRegex = /resolveJitiUrl\(|resolveJiti\(/;

    const versionIdx = src.search(versionRegex);
    const jitiIdx = src.search(jitiRegex);

    expect(versionIdx).toBeGreaterThan(-1);
    expect(jitiIdx).toBeGreaterThan(-1);
    expect(versionIdx).toBeLessThan(jitiIdx);

    expect(src).toMatch(/pkg\.version|\.version/);
    expect(src).toMatch(/package\.json/);
  });
});
