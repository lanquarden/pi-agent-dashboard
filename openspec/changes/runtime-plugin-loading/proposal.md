## Why

Dashboard plugins are build-time only. Vite generates `plugin-registry.tsx` from `packages/*/package.json`. External plugins can't ship React components without a dashboard rebuild. `external-dashboard-plugins` added server-side discovery, but client loading remains build-time.

Module Federation solves this: independently-built bundles share React singletons at runtime.

## What Changes

- **Rspack + MF host**: `rspack.config.ts` with `ModuleFederationPlugin`; Vite stays for dev. Shared scope: `react`, `react-dom`, `dashboard-plugin-runtime`.
- **`DashboardPluginApi`**: Typed API on `window.__piDashboard` — `registerClaim()`, `getSession()`, `onEvent()`, `showToast()`, config read/write. Modeled on piclaw's `AddonWebApiSurface`.
- **Plugin installation**: Dashboard plugins are installed via the server (not `pi install`). `<PluginsSection>` exposes install UI. Server fetches from npm, extracts to `~/.pi/dashboard/plugins/<id>/`, broadcasts `plugins_changed`.
- **Server plugin serving**: `GET /plugins/:id/*` serves plugin bundles from `~/.pi/dashboard/plugins/<id>/`. Dev override via `PI_DASHBOARD_PLUGIN_DEV` env var.
- **Runtime contract**: Plugins export `init(api)` from MF remote entry. Client fetches `/api/plugins`, loads enabled remotes, registers claims at runtime.
- **pi-dev-worktrees**: Two packages: pi extension (`@lanquarden/pi-dev-worktrees`, via `pi install`) + dashboard plugin (`@lanquarden/pi-dev-worktrees-dashboard-plugin`, via dashboard Plugins UI).
- **Build-time path preserved**: Workspace plugins unchanged; MF is additive.

## Capabilities

### New Capabilities

- `module-federation-host`: Rspack + MF host with singleton React scope.
- `dashboard-plugin-api`: `window.__piDashboard` typed API surface.
- `external-plugin-serving`: Static bundle serving at `/plugins/:id/*`.
- `runtime-plugin-contract`: `init(api)` export, manifest-driven loading, lifecycle cleanup.
- `plugin-install`: Server-side npm fetch + extract to `~/.pi/dashboard/plugins/`, UI in `<PluginsSection>`.

### Modified Capabilities

- `dashboard-plugin-loader`: Client-side runtime loader complements Vite plugin.
- `dashboard-plugin-architecture`: Slot registry extended with runtime add/remove.

## Impact

**Code**:
- `packages/client/rspack.config.ts` — new: MF host config.
- `packages/client/src/lib/plugin-loader.ts` — new: runtime remote loader.
- `packages/client/src/lib/plugin-api.ts` — new: `createDashboardPluginApi` factory.
- `packages/server/src/routes/plugin-bundle-routes.ts` — new: static bundle serving.
- `packages/server/src/routes/plugin-install-routes.ts` — new: install/remove/list plugins from npm.
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` — extended: `add()`, `remove()`, `removeByPlugin()`.
- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — modified: skip MF plugins in static registry.
- `packages/shared/src/dashboard-plugin/api.ts` — new: `DashboardPluginApi` interface.
- `packages/shared/src/dashboard-plugin/manifest-types.ts` — extended: optional `mfRemote` field.

**Dependencies**: `@rspack/core`, `@rspack/cli` (dev, pinned 1.x).
