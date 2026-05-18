/**
 * Bug D regression test: stale absolute symlinks under `<managedDir>/node_modules/`
 * pointing into `<bundleSource>/server/...` must NOT trip `ERR_FS_CP_EINVAL` in
 * `extractBundle`. The selective-wipe step inside `extractBundle` is responsible
 * for deleting them BEFORE `cpSync` runs.
 *
 * Pre-fix, `buildExtractedSource` passed a full ExtractFs with no-op overrides for
 * `mkdirSync` / `readdirSync` / `rmSync` / `statSync`, silently breaking the wipe
 * step. Stale symlinks survived; `cpSync` followed them back to source; EINVAL.
 *
 * This test exercises `extractBundle` directly (the unit-level surface) with the
 * Partial<ExtractFs> shape `buildExtractedSource` now passes (only file-content
 * probes; destructive ops default to real fs). It pre-populates the destination
 * with the exact stale-symlink pattern captured in `~/.pi/dashboard/server.log`
 * during cold-launch debugging.
 *
 * See change: fix-electron-cold-launch-probe-cascade (Bug D).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractBundle } from "../bundle-extract.js";

let root: string;
let managedDir: string;
let bundleSource: string;
let migrateDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "extract-stale-symlink-"));
  managedDir = path.join(root, "managed", ".pi-dashboard");
  bundleSource = path.join(root, "bundle", "resources", "server");
  migrateDir = path.join(root, "migrate", new Date().toISOString().replace(/:/g, "-"));
  fs.mkdirSync(managedDir, { recursive: true });
  fs.mkdirSync(bundleSource, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Build a minimal bundle source: it must contain a `node_modules/<pkg>/bin/<shim>`
 * real file (the source of the symlink the EINVAL chases). Plus the bundle's own
 * `.bin/<shim>` symlink pointing to it (mimicking npm's relative shim layout).
 */
function buildBundle() {
  const pkgBin = path.join(bundleSource, "node_modules", "fastify", "node_modules", "semver", "bin", "semver.js");
  fs.mkdirSync(path.dirname(pkgBin), { recursive: true });
  fs.writeFileSync(pkgBin, "#!/usr/bin/env node\nconsole.log('semver');\n");
  // Bundle's own relative bin shim — same pattern npm produces.
  const bundleShimDir = path.join(bundleSource, "node_modules", "fastify", "node_modules", ".bin");
  fs.mkdirSync(bundleShimDir, { recursive: true });
  fs.symlinkSync("../semver/bin/semver.js", path.join(bundleShimDir, "semver"));
  // Marker file so we can confirm cpSync overwrote.
  fs.writeFileSync(path.join(bundleSource, "FRESH"), "fresh-extract");
}

/**
 * Pre-populate destination with an absolute symlink that points INTO the bundle.
 * This is the exact pattern we captured live: `cpSync` follows it back to source,
 * tries to copy a file onto itself, throws EINVAL.
 */
function planStaleSymlink() {
  const staleDir = path.join(managedDir, "node_modules", "fastify", "node_modules", ".bin");
  fs.mkdirSync(staleDir, { recursive: true });
  const staleTarget = path.join(bundleSource, "node_modules", "fastify", "node_modules", "semver", "bin", "semver.js");
  fs.symlinkSync(staleTarget, path.join(staleDir, "semver"));
}

describe("extractBundle handles stale destination symlinks (Bug D)", () => {
  it("wipes pre-existing managedDir entries before cpSync; no EINVAL", () => {
    buildBundle();
    planStaleSymlink();

    // Sanity precondition: the stale symlink IS present and DOES resolve into the bundle.
    const staleLink = path.join(managedDir, "node_modules", "fastify", "node_modules", ".bin", "semver");
    expect(fs.existsSync(staleLink)).toBe(true);
    expect(fs.readlinkSync(staleLink)).toContain("/bundle/");

    // The fix: pass Partial<ExtractFs> with no destructive-op overrides. Real fs
    // wipes; cpSync writes to a clean destination.
    expect(() =>
      extractBundle(managedDir, bundleSource, "0.0.0-test", migrateDir, {
        existsSync: fs.existsSync,
        readFileSync: (p, enc) => fs.readFileSync(p, enc),
        writeFileSync: fs.writeFileSync,
        renameSync: fs.renameSync,
      }),
    ).not.toThrow();

    // Post-condition: bundle landed cleanly; the marker file is present.
    expect(fs.existsSync(path.join(managedDir, "FRESH"))).toBe(true);
    expect(fs.readFileSync(path.join(managedDir, "FRESH"), "utf-8")).toBe("fresh-extract");
    // .version marker written.
    expect(fs.readFileSync(path.join(managedDir, ".version"), "utf-8").trim()).toBe("0.0.0-test");
  });

  it("selective wipe deletes stale entries before re-extract", () => {
    buildBundle();
    planStaleSymlink();
    // Drop a top-level junk file too — wipe must remove anything non-SURVIVE.
    fs.writeFileSync(path.join(managedDir, "junk-from-prior-extract.txt"), "prior garbage");

    extractBundle(managedDir, bundleSource, "0.0.0-test", migrateDir, {
      existsSync: fs.existsSync,
      readFileSync: (p, enc) => fs.readFileSync(p, enc),
      writeFileSync: fs.writeFileSync,
      renameSync: fs.renameSync,
    });

    // The junk file from a prior install is gone (wipe ran).
    expect(fs.existsSync(path.join(managedDir, "junk-from-prior-extract.txt"))).toBe(false);
    // Fresh bundle landed.
    expect(fs.existsSync(path.join(managedDir, "FRESH"))).toBe(true);
  });
});
