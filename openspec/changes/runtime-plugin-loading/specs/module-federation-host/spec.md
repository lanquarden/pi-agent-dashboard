## ADDED Requirements

### Requirement: Rspack production build with MF host

The dashboard client SHALL have `packages/client/rspack.config.ts` with `rspack.container.ModuleFederationPlugin` configured as host. Shared scope SHALL include `react`, `react-dom`, and `@blackbelt-technology/dashboard-plugin-runtime` — all `singleton: true`. Output SHALL go to `dist/client/`. `npm run build` SHALL invoke Rspack; `npm run dev` SHALL stay Vite.

#### Scenario: Production build outputs MF host

- **WHEN** `npm run build` executes
- **THEN** `dist/client/index.html` loads, workspace plugins render, no `remoteEntry.js` in host output.

#### Scenario: React singleton enforced

- **WHEN** host and two remotes all import `react`
- **THEN** MF runtime SHALL resolve all to host's single React instance.

### Requirement: Shared build config

Aliases, env defines, and asset rules SHALL be extracted to `packages/client/build-config.ts`. Both `vite.config.ts` and `rspack.config.ts` SHALL import it.

#### Scenario: Alias applied to both bundlers

- **WHEN** `@shared/` alias added to `build-config.ts`
- **THEN** both Vite dev and Rspack prod SHALL resolve `@shared/` imports correctly.

### Requirement: Rspack 1.x pinned

`@rspack/core` and `@rspack/cli` SHALL be pinned at `^1.0.0`. MF v1.5 (bundled with Rspack 1.x) SHALL be used. Rspack 2.x SHALL be deferred to stable release.

#### Scenario: Version constraint enforced

- **WHEN** `npm install` executes
- **THEN** `node_modules/@rspack/core/package.json` SHALL have `version` field matching `1.x`.

### Requirement: `window.__piDashboard` proxy before scripts

An inline `<script>` in `index.html` SHALL create a proxy on `window.__piDashboard` that queues method calls until React mounts and calls `initDashboardPluginApi(api)`. The proxy SHALL replay the queue, then replace itself with the real API.

#### Scenario: Plugin calls API before React mounts

- **WHEN** remote entry script executes before `initDashboardPluginApi()` is called
- **THEN** `registerClaim()` calls SHALL be queued (not throw) and SHALL be replayed after init.

### Requirement: CSS extraction

`CssExtractRspackPlugin` SHALL be used for production builds. Plugins SHALL use the same in their configs. MF runtime SHALL auto-load remote CSS. `style-loader` SHALL be the fallback for edge cases.

#### Scenario: Plugin CSS loads with remote

- **WHEN** host loads `remoteEntry.js`
- **THEN** plugin's CSS SHALL load before module init executes — no FOUC.
