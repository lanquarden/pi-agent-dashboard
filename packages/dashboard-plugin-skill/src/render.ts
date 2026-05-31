/**
 * Template renderer for `dashboard-plugin-scaffold`.
 *
 * Two modes:
 *   - `new`     → write a fresh packages/<id>-plugin/ tree under outDir.
 *   - `augment` → mutate package.json at outDir + create src/dashboard/*.
 *
 * Pure-ish: takes typed answers + a filesystem-write hook. Test exercises
 * the renderer with an in-memory write hook to snapshot the tree.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { SLOT_SECTIONS, SLOT_RENDER_ORDER } from "./templates/slot-sections.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, "templates");

/** Slot ids accepted by the renderer (the 10 React slots). */
export type SlotId =
  | "sidebar-folder-section"
  | "session-card-badge"
  | "session-card-action-bar"
  | "content-view"
  | "content-header-sticky"
  | "content-inline-footer"
  | "anchored-popover"
  | "command-route"
  | "settings-section"
  | "tool-renderer";

export interface NewModeAnswers {
  mode: "new";
  /** Kebab-case id; final dir is `packages/<id>-plugin/`. */
  id: string;
  displayName: string;
  /** Default 100. */
  priority: number;
  /** Slots the user picked in the multiselect. */
  slots: SlotId[];
  /** Scaffold src/server/index.ts? */
  server: boolean;
  /** Scaffold src/bridge/index.ts? */
  bridge: boolean;
  /** Scaffold configSchema.json? */
  configSchema: boolean;
  /** Absolute path to write into. */
  outDir: string;
  /** Optional: scope the package.json `name` (defaults to `@blackbelt-technology/<id>-plugin`). */
  packageScope?: string;
  /** Versions for the SDK deps; default to "^0.x" so we don't hardwire releases. */
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  /** Required-API range surfaced in the manifest. */
  requiredApi?: string;
}

export interface AugmentProposal {
  file: string;
  line: number;
  callsite: string;
  mappedSlot: SlotId;
  componentSuggestion?: string;
  notes?: string;
}

export interface AugmentModeAnswers {
  mode: "augment";
  /** Project root to mutate (the user's pi-extension cwd). */
  outDir: string;
  /** User-confirmed proposals from the per-callsite multiselect. */
  confirmedProposals: AugmentProposal[];
  /** Add a server entry? Driven by the analyzer. */
  addServer: boolean;
  /** Optional override for the SDK dep version range. */
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  requiredApi?: string;
}

export type Answers = NewModeAnswers | AugmentModeAnswers | MfRemoteModeAnswers | MfAugmentModeAnswers;

/**
 * MF remote mode: scaffolds a standalone dashboard plugin that builds as
 * a Module Federation remote entry. Unlike new mode (Vite/build-time),
 * mf-remote plugins are loaded at runtime via dynamic import().
 *
 * See change: runtime-plugin-loading (Task 10).
 */
export interface MfRemoteModeAnswers {
  mode: "mf-remote";
  /** Kebab-case id; final dir is `<outDir>/`. */
  id: string;
  displayName: string;
  /** Default 100. */
  priority: number;
  /** Slots the user picked in the multiselect. */
  slots: SlotId[];
  /** Scaffold src/server/index.ts? */
  server: boolean;
  /** Scaffold src/bridge/index.ts? */
  bridge: boolean;
  /** Scaffold configSchema.json? */
  configSchema: boolean;
  /** Absolute path to write into. */
  outDir: string;
  /** Package scope (defaults to empty for standalone; use e.g. "@lanquarden"). */
  packageScope?: string;
  /** Versions for the SDK deps. */
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  /** Required-API range surfaced in the manifest. */
  requiredApi?: string;
}

/**
 * MF augment mode: adds MF remote scaffold (rspack.config.ts, init() entry,
 * mfRemote manifest) to an existing pi extension project.
 *
 * See change: runtime-plugin-loading (Task 10).
 */
export interface MfAugmentModeAnswers {
  mode: "mf-augment";
  /** Full path to the extension's root (contains package.json). */
  outDir: string;
  /** User-confirmed proposals from the per-callsite multiselect. */
  confirmedProposals: AugmentProposal[];
  /** Add a server entry? */
  addServer: boolean;
  runtimeVersionRange?: string;
  sharedVersionRange?: string;
  requiredApi?: string;
}

/** A virtual filesystem write — the test wires an in-memory map. */
export interface WriteSink {
  write(relativePath: string, content: string): void;
}

export class InMemorySink implements WriteSink {
  readonly files = new Map<string, string>();
  write(relativePath: string, content: string): void {
    this.files.set(relativePath.replace(/\\/g, "/"), content);
  }
}

export class FsSink implements WriteSink {
  constructor(private readonly root: string) {}
  write(relativePath: string, content: string): void {
    const abs = path.join(this.root, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
}

/** Pure entry point. Returns the sink for inspection. */
export function render(answers: Answers, sink: WriteSink = new InMemorySink()): WriteSink {
  if (answers.mode === "new") {
    renderNew(answers, sink);
  } else if (answers.mode === "augment") {
    renderAugment(answers, sink);
  } else if (answers.mode === "mf-remote") {
    renderMfRemote(answers, sink);
  } else {
    renderMfAugment(answers, sink);
  }
  return sink;
}

// ───────── new mode ─────────

function renderNew(a: NewModeAnswers, sink: WriteSink): void {
  validateNew(a);

  const packageScope = a.packageScope ?? "@blackbelt-technology";
  const packageName = `${packageScope}/${a.id}-plugin`;
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";
  const requiredApi = a.requiredApi ?? "^0.x";
  const ConfigTypeName = pascalCase(a.id) + "Config";

  // package.json
  const claims = buildClaims(a.slots, a.id);
  const exportsBlock = buildExportsBlock(a.server, a.bridge);

  const pkgJson = readTpl("plugin-package.json.tmpl")
    .replace(/\{\{ packageName \}\}/g, packageName)
    .replace(/\{\{ displayName \}\}/g, a.displayName)
    .replace(/\{\{ priority \}\}/g, String(a.priority))
    .replace(/\{\{ id \}\}/g, a.id)
    .replace(/\{\{ requiredApi \}\}/g, requiredApi)
    .replace(/\{\{ runtimeVersionRange \}\}/g, runtimeVersionRange)
    .replace(/\{\{ sharedVersionRange \}\}/g, sharedVersionRange)
    .replace(/\{\{ exportsBlock \}\}/g, exportsBlock)
    .replace(/\{\{ serverManifestField \}\}/g, a.server ? `,\n    "server": "./src/server/index.ts"` : "")
    .replace(/\{\{ bridgeManifestField \}\}/g, a.bridge ? `,\n    "bridge": "./src/bridge/index.ts"` : "")
    .replace(/\{\{ configSchemaManifestField \}\}/g, a.configSchema ? `,\n    "configSchema": "./configSchema.json"` : "")
    .replace(/\{\{ claimsBlock \}\}/g, JSON.stringify(claims, null, 6).replace(/\n/g, "\n    "));
  sink.write("package.json", pkgJson);

  // tsconfig + vitest config
  sink.write("tsconfig.json", readTpl("tsconfig.json.tmpl"));
  sink.write("vitest.config.ts", readTpl("vitest.config.ts.tmpl"));

  // configSchema.json (optional)
  if (a.configSchema) {
    sink.write(
      "configSchema.json",
      readTpl("configSchema.json.tmpl")
        .replace(/\{\{ packageName \}\}/g, packageName)
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id),
    );
  }

  // README
  const claimsList = a.slots.map((s) => `- \`${s}\` → \`${SLOT_SECTIONS[s]?.componentName ?? "?"}\``).join("\n");
  sink.write(
    "README.md",
    readTpl("README.md.tmpl")
      .replace(/\{\{ packageName \}\}/g, packageName)
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ id \}\}/g, a.id)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ claimsList \}\}/g, claimsList || "(none)"),
  );

  // src/client.tsx
  const slotSections = renderSlotSections(a.slots, a.id, ConfigTypeName);
  sink.write(
    "src/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ slotSections \}\}/g, slotSections),
  );

  // src/server/index.ts (optional)
  if (a.server) {
    sink.write(
      "src/server/index.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id)
        .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName),
    );
  }

  // src/bridge/index.ts (optional)
  if (a.bridge) {
    sink.write(
      "src/bridge/index.ts",
      readTpl("bridge-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, a.displayName)
        .replace(/\{\{ id \}\}/g, a.id)
        .replace(/\{\{ ToolName \}\}/g, pascalCase(a.id) + "Tool"),
    );
  }

  // test/index.test.ts
  sink.write(
    "test/index.test.ts",
    readTpl("test-index.test.ts.tmpl")
      .replace(/\{\{ displayName \}\}/g, a.displayName)
      .replace(/\{\{ packageName \}\}/g, packageName)
      .replace(/\{\{ id \}\}/g, a.id),
  );
}

function buildExportsBlock(server: boolean, bridge: boolean): string {
  const entries: Record<string, string> = { "./client": "./src/client.tsx" };
  if (server) entries["./server"] = "./src/server/index.ts";
  if (bridge) entries["./bridge"] = "./src/bridge/index.ts";
  // 4-space indent, then a tail indent of 2 to align inside the package.json template.
  const json = JSON.stringify(entries, null, 4);
  return json.replace(/\n/g, "\n  ");
}

function buildClaims(slots: SlotId[], id: string): Array<Record<string, unknown>> {
  // Stable order matching SLOT_RENDER_ORDER for deterministic output.
  const ordered = SLOT_RENDER_ORDER.filter((s) => slots.includes(s as SlotId)) as SlotId[];
  const out: Array<Record<string, unknown>> = [];
  for (const slot of ordered) {
    const sec = SLOT_SECTIONS[slot];
    if (!sec) continue;
    const claim: Record<string, unknown> = { slot, component: sec.componentName };
    if (slot === "command-route") claim.command = `/${id}`;
    if (slot === "anchored-popover") claim.trigger = `${id}-popover`;
    if (slot === "tool-renderer") claim.toolName = `${pascalCase(id)}Tool`;
    if (slot === "settings-section") claim.config = { tab: "general" };
    out.push(claim);
  }
  return out;
}

function renderSlotSections(slots: SlotId[], id: string, configTypeName: string): string {
  const ordered = SLOT_RENDER_ORDER.filter((s) => slots.includes(s as SlotId)) as SlotId[];
  return ordered
    .map((s) => SLOT_SECTIONS[s]?.render({ id, configTypeName }) ?? "")
    .join("\n")
    .trim() + "\n";
}

function validateNew(a: { id: string; priority: number; slots: string[] }): void {
  if (!/^[a-z][a-z0-9-]*$/.test(a.id)) {
    throw new Error(`id "${a.id}" must be kebab-case (^[a-z][a-z0-9-]*$)`);
  }
  if (!Number.isInteger(a.priority) || a.priority < 0) {
    throw new Error(`priority must be a non-negative integer; got ${a.priority}`);
  }
  if (!Array.isArray(a.slots) || a.slots.length === 0) {
    throw new Error("must claim at least one slot");
  }
  for (const s of a.slots) {
    if (!(s in SLOT_SECTIONS)) {
      throw new Error(`unknown slot id: ${s}`);
    }
  }
}

// ───────── augment mode ─────────

function renderAugment(a: AugmentModeAnswers, sink: WriteSink): void {
  const requiredApi = a.requiredApi ?? "^0.x";
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";

  // Read the existing package.json from disk.
  const pkgPath = path.join(a.outDir, "package.json");
  const existing = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;

  // Derive a plugin id from the package name (strip scope, strip leading "pi-").
  const pkgName = String(existing.name ?? "");
  const id = pkgName
    .replace(/^@[^/]+\//, "")
    .replace(/^pi-/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "augmented-plugin";
  const displayName = String(existing.description ?? id);

  // Derive slots from confirmed proposals; collapse duplicates.
  const slots = Array.from(new Set(a.confirmedProposals.map((p) => p.mappedSlot)));
  const claims = buildClaims(slots as SlotId[], id);
  // Fold per-proposal componentSuggestion when provided.
  for (const p of a.confirmedProposals) {
    const claim = claims.find((c) => c.slot === p.mappedSlot);
    if (claim && p.componentSuggestion) claim.component = p.componentSuggestion;
  }

  // Merge dependencies — preserve existing, add SDK deps in alpha order.
  const deps: Record<string, string> = { ...((existing.dependencies as Record<string, string>) ?? {}) };
  deps["@blackbelt-technology/dashboard-plugin-runtime"] = runtimeVersionRange;
  deps["@blackbelt-technology/pi-dashboard-shared"] = sharedVersionRange;
  const sortedDeps: Record<string, string> = {};
  for (const k of Object.keys(deps).sort()) sortedDeps[k] = deps[k];
  existing.dependencies = sortedDeps;

  // Merge exports.
  const existingExports = (existing.exports as Record<string, unknown>) ?? {};
  existingExports["./client"] = "./src/dashboard/client.tsx";
  if (a.addServer) existingExports["./server"] = "./src/dashboard/server.ts";
  existing.exports = existingExports;

  // Inject manifest field at top level.
  const manifest: Record<string, unknown> = {
    id,
    displayName,
    priority: 100,
    requiredApi,
    client: "./src/dashboard/client.tsx",
  };
  if (a.addServer) manifest.server = "./src/dashboard/server.ts";
  manifest.claims = claims;
  existing["pi-dashboard-plugin"] = manifest;

  sink.write("package.json", JSON.stringify(existing, null, 2) + "\n");

  // Scaffold src/dashboard/client.tsx with stubs for each confirmed claim.
  const ConfigTypeName = pascalCase(id) + "Config";
  const slotSections = renderSlotSections(slots as SlotId[], id, ConfigTypeName);
  sink.write(
    "src/dashboard/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{ displayName \}\}/g, displayName)
      .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName)
      .replace(/\{\{ slotSections \}\}/g, slotSections),
  );

  // Server entry only if needed.
  if (a.addServer) {
    sink.write(
      "src/dashboard/server.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{ displayName \}\}/g, displayName)
        .replace(/\{\{ id \}\}/g, id)
        .replace(/\{\{ ConfigTypeName \}\}/g, ConfigTypeName),
    );
  }
}

// ───────── mf-remote mode ─────────

function renderMfRemote(a: MfRemoteModeAnswers, sink: WriteSink): void {
  validateNew(a);

  const packageScope = a.packageScope ? `${a.packageScope}/` : "";
  const packageName = `${packageScope}${a.id}-dashboard-plugin`;
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";
  const requiredApi = a.requiredApi ?? "^0.x";
  const ConfigTypeName = pascalCase(a.id) + "Config";

  // package.json — MF remote variant
  const claims = buildClaims(a.slots, a.id);
  const pkgJson = readTpl("plugin-package.json.tmpl")
    .replace(/\{\{\{ packageName \}\}\}/g, packageName)
    .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
    .replace(/\{\{\{ priority \}\}\}/g, String(a.priority))
    .replace(/\{\{\{ id \}\}\}/g, a.id)
    .replace(/\{\{\{ requiredApi \}\}\}/g, requiredApi)
    .replace(/\{\{\{ runtimeVersionRange \}\}\}/g, runtimeVersionRange)
    .replace(/\{\{\{ sharedVersionRange \}\}\}/g, sharedVersionRange)
    .replace(/\{\{\{ exportsBlock \}\}\}/g, "{}\\n  ")
    .replace(/\{\{\{ serverManifestField \}\}\}/g, a.server ? `,\
    "server": "./src/server/index.ts"` : "")
    .replace(/\{\{\{ bridgeManifestField \}\}\}/g, a.bridge ? `,\
    "bridge": "./src/bridge/index.ts"` : "")
    .replace(/\{\{\{ configSchemaManifestField \}\}\}/g, a.configSchema ? `,\
    "configSchema": "./configSchema.json"` : "")
    .replace(/\{\{\{ claimsBlock \}\}\}/g, JSON.stringify(claims, null, 6).replace(/\n/g, "\n    "))
    // Inject mfRemote into the manifest
    .replace(
      '"client": "./src/client.tsx"',
      '"client": "./src/client.tsx",\n    "mfRemote": "./dist/remoteEntry.js"',
    )
    // Replace Vite devDep with Rspack devDeps
    .replace(
      '"@vitejs/plugin-react": "^6.0.2"',
      '"@rspack/cli": "^1.7.0",\n    "@rspack/core": "^1.7.0"',
    )
    // Replace scripts
    .replace('"build": "vite build"', '"build": "rspack build"')
    .replace('"dev": "vite"', '"dev": "rspack serve"');
  sink.write("package.json", pkgJson);

  // dashboard-plugin.json — standalone manifest for runtime discovery
  const manifest: Record<string, unknown> = {
    id: a.id,
    displayName: a.displayName,
    priority: a.priority,
    mfRemote: "./dist/remoteEntry.js",
    claims: claims.map((c: Record<string, unknown>) => {
      const { Component, ...rest } = c;
      return rest;
    }),
  };
  sink.write("dashboard-plugin.json", JSON.stringify(manifest, null, 2) + "\n");

  // rspack.config.ts — MF remote build
  const rspackConfig = generateRspackRemoteConfig(a.id);
  sink.write("rspack.config.ts", rspackConfig);

  // tsconfig + vitest config
  sink.write("tsconfig.json", readTpl("tsconfig.json.tmpl"));
  sink.write("vitest.config.ts", readTpl("vitest.config.ts.tmpl"));

  // configSchema.json (optional)
  if (a.configSchema) {
    sink.write(
      "configSchema.json",
      readTpl("configSchema.json.tmpl")
        .replace(/\{\{\{ packageName \}\}\}/g, packageName)
        .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
        .replace(/\{\{\{ id \}\}\}/g, a.id),
    );
  }

  // README
  const claimsList = a.slots.map((s) => `- \`${s}\` → \`${SLOT_SECTIONS[s]?.componentName ?? "?"}\``).join("\n");
  sink.write(
    "README.md",
    readTpl("README.md.tmpl")
      .replace(/\{\{\{ packageName \}\}\}/g, packageName)
      .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
      .replace(/\{\{\{ id \}\}\}/g, a.id)
      .replace(/\{\{\{ ConfigTypeName \}\}\}/g, ConfigTypeName)
      .replace(/\{\{\{ claimsList \}\}\}/g, claimsList || "(none)"),
  );

  // src/index.tsx — MF remote entry with init(api)
  const initExport = generateInitExport(a.slots, a.id, ConfigTypeName);
  sink.write("src/index.tsx", initExport);

  // src/client.tsx — component stubs (for dev/testing)
  const slotSections = renderSlotSections(a.slots, a.id, ConfigTypeName);
  sink.write(
    "src/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
      .replace(/\{\{\{ ConfigTypeName \}\}\}/g, ConfigTypeName)
      .replace(/\{\{\{ slotSections \}\}\}/g, slotSections),
  );

  // src/server/index.ts (optional)
  if (a.server) {
    sink.write(
      "src/server/index.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
        .replace(/\{\{\{ id \}\}\}/g, a.id)
        .replace(/\{\{\{ ConfigTypeName \}\}\}/g, ConfigTypeName),
    );
  }

  // src/bridge/index.ts (optional)
  if (a.bridge) {
    sink.write(
      "src/bridge/index.ts",
      readTpl("bridge-index.ts.tmpl")
        .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
        .replace(/\{\{\{ id \}\}\}/g, a.id)
        .replace(/\{\{\{ ToolName \}\}\}/g, pascalCase(a.id) + "Tool"),
    );
  }

  // test/index.test.ts
  sink.write(
    "test/index.test.ts",
    readTpl("test-index.test.ts.tmpl")
      .replace(/\{\{\{ displayName \}\}\}/g, a.displayName)
      .replace(/\{\{\{ packageName \}\}\}/g, packageName)
      .replace(/\{\{\{ id \}\}\}/g, a.id),
  );
}

// ───────── mf-augment mode ─────────

function renderMfAugment(a: MfAugmentModeAnswers, sink: WriteSink): void {
  const requiredApi = a.requiredApi ?? "^0.x";
  const runtimeVersionRange = a.runtimeVersionRange ?? "^0.x";
  const sharedVersionRange = a.sharedVersionRange ?? "^0.x";

  // Read the existing package.json from disk.
  const pkgPath = path.join(a.outDir, "package.json");
  const existing = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;

  // Derive a plugin id from the package name.
  const pkgName = String(existing.name ?? "");
  const id = pkgName
    .replace(/^@[^/]+\//, "")
    .replace(/^pi-/, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "augmented-plugin";
  const displayName = String(existing.description ?? id);

  // Derive slots from confirmed proposals.
  const slots = Array.from(new Set(a.confirmedProposals.map((p) => p.mappedSlot))) as SlotId[];
  const claims = buildClaims(slots, id);
  for (const p of a.confirmedProposals) {
    const claim = claims.find((c) => c.slot === p.mappedSlot);
    if (claim && p.componentSuggestion) claim.component = p.componentSuggestion;
  }

  // Merge devDependencies — add Rspack.
  const devDeps: Record<string, string> = { ...((existing.devDependencies as Record<string, string>) ?? {}) };
  devDeps["@rspack/cli"] = "^1.7.0";
  devDeps["@rspack/core"] = "^1.7.0";
  const sortedDevDeps: Record<string, string> = {};
  for (const k of Object.keys(devDeps).sort()) sortedDevDeps[k] = devDeps[k];
  existing.devDependencies = sortedDevDeps;

  // Merge dependencies — add SDK deps.
  const deps: Record<string, string> = { ...((existing.dependencies as Record<string, string>) ?? {}) };
  deps["@blackbelt-technology/dashboard-plugin-runtime"] = runtimeVersionRange;
  deps["@blackbelt-technology/pi-dashboard-shared"] = sharedVersionRange;
  const sortedDeps: Record<string, string> = {};
  for (const k of Object.keys(deps).sort()) sortedDeps[k] = deps[k];
  existing.dependencies = sortedDeps;

  // Add build script.
  const scripts = (existing.scripts as Record<string, string>) ?? {};
  if (!scripts.build) scripts.build = "rspack build";
  existing.scripts = scripts;

  // Inject/update pi-dashboard-plugin manifest with mfRemote.
  const manifest = (existing["pi-dashboard-plugin"] as Record<string, unknown>) ?? {};
  manifest.mfRemote = "./dist/remoteEntry.js";
  manifest.claims = claims;
  existing["pi-dashboard-plugin"] = manifest;

  sink.write("package.json", JSON.stringify(existing, null, 2) + "\n");

  // Scaffold MF remote entry (src/dashboard/index.tsx -> init(api))
  const ConfigTypeName = pascalCase(id) + "Config";
  const initExport = generateInitExport(slots, id, ConfigTypeName);
  sink.write("src/dashboard/index.tsx", initExport);

  // Scaffold component stubs (src/dashboard/client.tsx)
  const slotSections = renderSlotSections(slots, id, ConfigTypeName);
  sink.write(
    "src/dashboard/client.tsx",
    readTpl("client.tsx.tmpl")
      .replace(/\{\{\{ displayName \}\}\}/g, displayName)
      .replace(/\{\{\{ ConfigTypeName \}\}\}/g, ConfigTypeName)
      .replace(/\{\{\{ slotSections \}\}\}/g, slotSections),
  );

  // Scaffold rspack.config.ts
  const rspackConfig = generateRspackRemoteConfig(id);
  sink.write("rspack.config.ts", rspackConfig);

  // Server entry only if needed.
  if (a.addServer) {
    sink.write(
      "src/dashboard/server.ts",
      readTpl("server-index.ts.tmpl")
        .replace(/\{\{\{ displayName \}\}\}/g, displayName)
        .replace(/\{\{\{ id \}\}\}/g, id)
        .replace(/\{\{\{ ConfigTypeName \}\}\}/g, ConfigTypeName),
    );
  }
}

// ───────── MF remote helpers ─────────

/**
 * Generate the init(api) export for an MF remote plugin entry.
 */
function generateInitExport(slots: SlotId[], id: string, _configTypeName: string): string {
  const ordered = SLOT_RENDER_ORDER.filter((s) => slots.includes(s as SlotId)) as SlotId[];
  const registrations: string[] = [];
  const imports: string[] = [
    `import type { DashboardPluginApi } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/api.js";`,
  ];

  for (const slot of ordered) {
    const sec = SLOT_SECTIONS[slot];
    if (!sec) continue;
    // Import from the barrel file (src/client.tsx) which exports all components.
    // Plugin authors split into individual files later if desired.
    imports.push(`import { ${sec.componentName} } from "./client.js";`);

    const claimObj: Record<string, string> = {
      slot: JSON.stringify(slot),
      component: sec.componentName,
    };
    if (slot === "command-route") claimObj.command = JSON.stringify(`/${id}`);
    if (slot === "tool-renderer") claimObj.toolName = JSON.stringify(`${pascalCase(id)}Tool`);

    const claimLiteral = Object.entries(claimObj)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");

    registrations.push(`  cleanups.push(api.registerClaim({ ${claimLiteral} }));`);
  }

  return `/**
 * MF remote entry point for ${id}-dashboard-plugin.
 */
${imports.join("\n")}

/**
 * Called by the host after dynamic import. Registers all slot claims and
 * returns a cleanup function for unloading.
 */
export function init(api: DashboardPluginApi): () => void {
  const cleanups: Array<() => void> = [];

${registrations.join("\n") || "  // No claims registered"}

  return () => {
    for (const fn of cleanups) fn();
  };
}
`;
}

/** Generate rspack.config.ts for an MF remote plugin. */
function generateRspackRemoteConfig(id: string): string {
  return `import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    main: "./src/index.tsx",
  },

  output: {
    path: path.resolve(__dirname, "dist"),
    publicPath: "auto",
    filename: "remoteEntry.js",
    chunkFilename: "assets/[name].[contenthash:8].js",
    cssFilename: "assets/[name].[contenthash:8].css",
    clean: true,
  },

  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".ts", ".jsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },

  module: {
    rules: [
      {
        test: /\\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic" } },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
    ],
  },

  plugins: [
    new rspack.container.ModuleFederationPlugin({
      name: "${pascalCase(id)}Dashboard",
      filename: "remoteEntry.js",
      exposes: {
        ".": "./src/index.tsx",
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: false,
        },
        "react-dom": {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: false,
        },
        "@blackbelt-technology/dashboard-plugin-runtime": {
          singleton: true,
          eager: false,
          requiredVersion: false,
        },
      },
    }),
  ],

  experiments: {
    css: true,
  },

  stats: "errors-warnings",
  devtool: "source-map",
});
`;
}

// ───────── helpers ─────────

function readTpl(name: string): string {
  return fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
}

function pascalCase(kebab: string): string {
  return kebab
    .split("-")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}
