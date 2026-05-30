## 1. Rspack + MF host

- [ ] 1.1 Add `@rspack/core`, `@rspack/cli` (dev, pinned 1.x).
- [ ] 1.2 Create `packages/client/rspack.config.ts`: `ModuleFederationPlugin` host, shared `{ react, react-dom, dashboard-plugin-runtime }` singleton, `CssExtractRspackPlugin`, `output.publicPath: 'auto'`.
- [ ] 1.3 Extract shared config (aliases, defines, assets) to `packages/client/build-config.ts`.
- [ ] 1.4 `build` script → `rspack build`; `dev` stays `vite`.
- [ ] 1.5 Add `window.__piDashboard` proxy `<script>` to `index.html`.
- [ ] 1.6 Test: prod build loads, workspace plugins render, no console errors.

## 2. DashboardPluginApi

- [ ] 2.1 Define `DashboardPluginApi` interface in `packages/shared/src/dashboard-plugin/api.ts`.
- [ ] 2.2 Implement `createDashboardPluginApi(deps)` in `packages/client/src/lib/plugin-api.ts`: scoped per pluginId, delegates to slot registry / session store / WS bus / toast dispatcher / config endpoints.
- [ ] 2.3 `registerClaim` validates slot id against `SLOT_DEFINITIONS`; throws on invalid slot or missing component.
- [ ] 2.4 Unit tests: claim add/remove, session read, event filter, config round-trip, invalid slot throws.

## 3. Runtime plugin loader

- [ ] 3.1 Create `packages/client/src/lib/plugin-loader.ts`: `fetchManifests()`, `loadRemotePlugin(manifest)`, `unloadPlugin(id)`, `handlePluginsChanged(plugins)`.
- [ ] 3.2 Wire `handlePluginsChanged` to `plugins_changed` WS event.
- [ ] 3.3 Preflight `HEAD` to `mfRemote` URL before `import()`. Catch errors, surface in `PluginStatusStore`.
- [ ] 3.4 Unit tests: mock `import()`, verify claims registered, cleanup on unload, error surfacing.

## 4. Server bundle serving

- [ ] 4.1 Create `packages/server/src/routes/plugin-bundle-routes.ts`: `GET /plugins/:id/*`, resolve `:id` to `~/.pi/dashboard/plugins/<id>/`, serve wildcard path relative to that directory, MIME types, `Cache-Control`.
- [ ] 4.2 Gate through `localhostGuard`.
- [ ] 4.3 Dev override: `PI_DASHBOARD_PLUGIN_DEV` env var proxies to plugin dev server; falls back to disk.
- [ ] 4.4 Integration test: build fixture plugin, verify `GET /plugins/fixture/remoteEntry.js` returns 200.

## 5. Plugin install routes

- [ ] 5.1 Create `packages/server/src/routes/plugin-install-routes.ts`: `POST /api/plugins/install { source: "npm:<pkg>" }` fetches package from npm, extracts to `~/.pi/dashboard/plugins/<id>/`, broadcasts `plugins_changed`.
- [ ] 5.2 `POST /api/plugins/uninstall/:id` removes plugin directory, broadcasts `plugins_changed`.
- [ ] 5.3 `GET /api/plugins/available` searches npm for `pi-dashboard-plugin` keyword.
- [ ] 5.4 Install UI in `<PluginsSection>`: search input, install button, progress feedback.
- [ ] 5.5 Integration test: install plugin via API, verify directory created and bundle served.

## 6. Manifest + mfRemote

- [ ] 6.1 Add `mfRemote?: string` to `PluginManifest` in `manifest-types.ts`.
- [ ] 6.2 Server resolves `mfRemote` to URL `/plugins/<id>/<mfRemote>` (e.g. `/plugins/<id>/dist/remoteEntry.js`); populates in `PluginStatus`.
- [ ] 6.3 `GET /api/plugins` includes `mfRemote` URL in response.
- [ ] 6.4 `PluginStatus.source` enum gains `"dashboard-installed"`.
- [ ] 6.5 `discoverPlugins()` scans `~/.pi/dashboard/plugins/<id>/dashboard-plugin.json` as third source.
- [ ] 6.6 Vite plugin skips manifests with `mfRemote`; adds exclusion comment in generated file.
- [ ] 6.7 `loadServerEntries()` also imports server modules from dashboard-installed plugins.

## 7. SlotRegistry runtime extension

- [ ] 7.1 Add `add(entry)`, `remove(id)`, `removeByPlugin(pluginId)` to `SlotRegistry`.
- [ ] 7.2 Consumers react to runtime changes (useSyncExternalStore or subscription).
- [ ] 7.3 Unit tests: add/remove claims, batch add, remove by plugin id.

## 8. SlotErrorBoundary hardening

- [ ] 8.1 Catch errors from dynamically-loaded remote components.
- [ ] 8.2 Log, render error pill in dev, nothing in prod. Report to `PluginStatusStore`.
- [ ] 8.3 Unit test: remote component throws, siblings survive.

## 9. pi-dev-worktrees external plugin

- [ ] 9.1 Create `@lanquarden/pi-dev-worktrees-dashboard-plugin` as standalone package (separate from pi extension).
- [ ] 9.2 Add `rspack.config.ts` (MF remote), `src/index.tsx` (exports `init`), component files.
- [ ] 9.3 Add `dashboard-plugin.json` with `mfRemote` and claims.
- [ ] 9.4 Add `build` / `dev` scripts for the dashboard plugin.
- [ ] 9.5 Build, publish. Manual smoke test: install extension via `pi install`, install plugin via dashboard Plugins UI, verify components render.

## 10. Plugin scaffold skill

- [ ] 10.1 Extend `dashboard-plugin-skill` with `mf-remote` mode: generates Rspack config, `init()` template, manifest.
- [ ] 10.2 Add `mf-augment` mode: adds MF remote scaffold to existing pi extension.

## 11. Documentation

- [ ] 11.1 Add `docs/external-plugin-authoring.md`: scaffold, build, publish, API reference.
- [ ] 11.2 Update `docs/plugin-architecture.md` with runtime loading flow and MF topology.
- [ ] 11.3 FAQ entries: "plugin not rendering", "failed to load remote entry", "how to build a plugin".
- [ ] 11.4 Delegate `docs/` writes to general-purpose subagent in caveman style per AGENTS.md.

## 12. End-to-end verification

- [ ] 12.1 Prod build + workspace plugins render.
- [ ] 12.2 Install pi-dev-worktrees extension via `pi install`, install dashboard plugin via Plugins UI. Verify claims render.
- [ ] 12.3 Uninstall plugin via UI → claims disappear. Re-install → reappear without refresh.
- [ ] 12.4 Broken plugin (404 remote) → error in `<PluginsSection>`.
- [ ] 12.5 `npm test` — all existing tests pass.
- [ ] 12.6 `openspec validate runtime-plugin-loading --strict` passes.
