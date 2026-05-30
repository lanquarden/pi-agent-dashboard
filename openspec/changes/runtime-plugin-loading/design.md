## Context

Dashboard plugins shipped as build-time-only. Two changes are in flight:
- `dashboard-plugin-architecture` (archived): 20-slot taxonomy, `SlotRegistry`, Vite plugin generating `plugin-registry.tsx`.
- `external-dashboard-plugins` (active): Server-side discovery of pi-installed packages, `PluginStatusStore`, `<PluginsSection>`. Adds `source: "global"` / `"workspace"` / `"local-detected"` to `PluginStatus`.

This change adds a **third discovery source** (`~/.pi/dashboard/plugins/<id>/`, `source: "dashboard-installed"`) and the client-side runtime loading path. It does NOT remove or conflict with the other two sources.

Client loading is unchanged — the Vite plugin generates static imports at build time. External plugins with React components require a rebuild. Module Federation is the fix: host negotiates `singleton` React with remotes, preventing dual-React bugs.

piclaw demonstrated a clean `AddonWebApiSurface` pattern: plugins call global registration functions that return unregister functions. The dashboard needs both: MF for singleton sharing, a typed API for ergonomics.

## Goals / Non-Goals

**Goals**: Install dashboard plugin via Plugins UI (server fetches from npm, extracts to `~/.pi/dashboard/plugins/<id>/`), see components render without rebuild. Plugins built independently (own Rspack config). `DashboardPluginApi` provides minimal surface. Workspace plugins unchanged. New plugins appear within ~2s of `plugins_changed`.

**Non-Goals**: Removing Vite build path. Full Rspack migration. Plugin sandboxing. Inter-plugin MF dependencies beyond `react`/`react-dom`/`runtime`. Dynamic remotes from arbitrary URLs.

## Decisions

### Decision 1: Rspack host + Vite dev

Rspack with `rspack.container.ModuleFederationPlugin` for production. Vite stays for dev HMR. Two configs share aliases/defines via `build-config.ts`.

**Rejected**: `@originjs/vite-plugin-federation` (unstable), full Webpack (slower), dynamic `import()` without MF (dual-React bugs).

### Decision 2: `init(api)` export contract

External plugins export `init(api: DashboardPluginApi): void | (() => void)` from their MF remote entry. Host calls `init(api)` after import. No global timing race. Returns optional cleanup function.

```typescript
// Plugin remote entry
export function init(api: DashboardPluginApi): () => void {
  const unreg = api.registerClaim({ slot: 'session-card-badge', component: Badge });
  return () => unreg();
}
```

### Decision 3: `DashboardPluginApi` on `window.__piDashboard`

Proxy-initialized in `<script>` before any remote loads. Queues calls until React mounts, then replays. Final API provides:

| Method | Returns |
|--------|---------|
| `registerClaim(claim)` | unregister fn |
| `getSession(id)` | `DashboardSession \| undefined` |
| `getAllSessions()` | `DashboardSession[]` |
| `subscribeSession(fn)` | unsubscribe fn |
| `onEvent(type, fn)` | unsubscribe fn |
| `showToast(msg, variant?)` | void |
| `getConfig<T>()` / `setConfig(partial)` | `T` / `Promise<void>` |
| `pluginId` (readonly) | `string` |

### Decision 4: Plugin installation via server (separate from pi install)

Dashboard plugins are NOT installed via `pi install`. The server SHALL provide `POST /api/plugins/install { source: "npm:<pkg>" }` to fetch the npm tarball and extract it to `~/.pi/dashboard/plugins/<id>/`. `<PluginsSection>` SHALL expose search + install UI. After extraction, `discoverPlugins()` rescans and broadcasts `plugins_changed`. This is separate from pi extension installation (`pi install`).

### Decision 5: Three discovery sources, `dashboard-installed` is third

`discoverPlugins()` SHALL scan three sources in order:
1. Workspace: `<dashboard-cwd>/packages/*/package.json` (`source: "workspace"`)
2. Pi-installed: `~/.pi/agent/settings.json#packages[]` (`source: "global"`, from `external-dashboard-plugins`)
3. Dashboard-installed: `~/.pi/dashboard/plugins/<id>/dashboard-plugin.json` (`source: "dashboard-installed"`, new)

Earlier sources shadow later ones. The `external-dashboard-plugins` change's `PluginStatus.source` enum gains `"dashboard-installed"`.

### Decision 6: Manifest lives in extracted plugin directory

The dashboard plugin package contains a `dashboard-plugin.json` at its root (or `pi-dashboard-plugin` in `package.json`). When extracted to `~/.pi/dashboard/plugins/<id>/`, the manifest is at `~/.pi/dashboard/plugins/<id>/dashboard-plugin.json`. `mfRemote` is a path relative to the manifest (`./dist/remoteEntry.js`). The server resolves it to URL `/plugins/<id>/dist/remoteEntry.js`.

### Decision 7: Server serves pre-built bundles from plugin root

Route `GET /plugins/:id/*` serves `<path>` relative to `~/.pi/dashboard/plugins/<id>/`. Plugin authors build before publishing (output goes to `dist/`). Server does NOT build plugins. `vite-plugin` detects `mfRemote` and excludes from static registry. Dev override via `PI_DASHBOARD_PLUGIN_DEV={"id":"http://localhost:3456"}` proxies to plugin dev server.

### Decision 8: Server entries for external plugins loaded dynamically

`loadServerEntries()` SHALL also scan `~/.pi/dashboard/plugins/<id>/` for manifests with a `server` entry. It SHALL dynamic-import the server module from the extracted plugin directory. Failure-isolated: a broken server entry from a dashboard-installed plugin SHALL NOT crash the server or prevent other plugins from loading.

### Decision 9: pi-dev-worktrees as two packages, different install paths

Pi extension (`@lanquarden/pi-dev-worktrees`) via `pi install`. Dashboard plugin (`@lanquarden/pi-dev-worktrees-dashboard-plugin`) via dashboard Plugins UI (`POST /api/plugins/install`). The dashboard plugin is a standalone MF remote with no pi extension code.

### Decision 10: Workspace plugin migration

Workspace plugins unchanged. To migrate: extract to own repo, add `dashboard/rspack.config.ts` (MF remote), add `mfRemote` to manifest. Vite plugin skips manifests with `mfRemote`. `dashboard-plugin-skill` extended with `mf-remote` mode.

### Decision 11: Lifecycle cleanup

On unload: call `init()` cleanup, all `registerClaim()` unregisters, all `onEvent()`/`subscribeSession()` unsubscribes, remove claims from registry. Tracked per pluginId in `Map<string, Array<() => void>>`.

## Risks / Trade-offs

- **[Risk] Two bundlers** (Vite + Rspack). Mitigation: shared `build-config.ts`. Re-evaluate full Rspack migration when dev server matures.
- **[Risk] React version skew**. Mitigation: `singleton: true, requiredVersion: '^19.0.0'`. Host warns on version mismatch.
- **[Risk] Broken remote entry** (404/eval error). Mitigation: preflight `HEAD`, catch `import()` errors, surface in `<PluginsSection>`.
- **[Trade-off] External plugins must pre-build**. Mitigation: `dashboard-plugin-skill` scaffolds build scripts + watch mode.

## Migration Plan

Additive. Workspace plugins unchanged. Rspack replaces Vite for `npm run build` only. `/api/plugins` gains `mfRemote` (additive). New routes under `/plugins/:id/`. Rollback: revert to Vite build, remove routes, remove `window.__piDashboard`.

## Open Questions

1. **Rspack 1.x vs 2.x**. 2.x introduces MF v2 runtime. Pin 1.x until stable.
2. **CSS loading for remotes**. Extract (`CssExtractRspackPlugin`) or inline (`style-loader`)? Lean: extract for production, inline for simplicity in first release.
3. **Plugin chunk publicPath**. `output.publicPath: 'auto'` should resolve `/plugins/<id>/` correctly — needs verification.
4. **React 18 fallback for legacy plugins**. Lean: require React 19. Document in authoring guide.
5. **Extension UI coexistence**. pi-dev-worktrees has descriptor-only UI (`footer-segment`, `management-modal`). Keep as TUI fallback; MF plugin adds dashboard-only React components.
