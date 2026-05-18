/**
 * Repo-lint: `packages/electron/src/lib/launch-source.ts` MUST NOT read
 * the `extensions[]` field from pi's settings.json (a field that does not
 * exist in pi's actual schema and never produced a probe hit). Guards
 * against regression of Bug A.
 *
 * See change: fix-electron-cold-launch-probe-cascade.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const launchSourcePath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "electron",
  "src",
  "lib",
  "launch-source.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

describe("launch-source.ts — no settings.extensions reads (Bug A regression guard)", () => {
  it("does not read 'extensions' field from pi settings.json (executable code only)", () => {
    const code = stripComments(fs.readFileSync(launchSourcePath, "utf-8"));
    expect(code).not.toMatch(/extensions\s*\?\s*:/);
    expect(code).not.toMatch(/\bsettings\.extensions\b/);
    expect(code).not.toMatch(/\bsettings\?\.extensions\b/);
    expect(code).toMatch(/listPiPackages/);
  });
});
