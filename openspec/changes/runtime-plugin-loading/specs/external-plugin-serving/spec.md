## ADDED Requirements

### Requirement: Server serves plugin bundles

A route handler at `packages/server/src/routes/plugin-bundle-routes.ts` SHALL serve `GET /plugins/:id/*`. It SHALL resolve `:id` to `~/.pi/dashboard/plugins/<id>/` and serve the wildcard path relative to that directory. `mfRemote` is a path relative to the manifest (e.g. `./dist/remoteEntry.js`). The server constructs the full URL as `/plugins/<id>/dist/remoteEntry.js` by prepending `/plugins/<id>/` to the manifest-relative path. `Content-Type` SHALL be set by extension. `Cache-Control: immutable` for hashed filenames. 404 if plugin unknown or file missing.

#### Scenario: Remote entry served

- **WHEN** `GET /plugins/pi-dev-worktrees/dist/remoteEntry.js`
- **THEN** server SHALL serve `~/.pi/dashboard/plugins/pi-dev-worktrees/dist/remoteEntry.js` with `Content-Type: application/javascript`.

#### Scenario: Hashed chunk cached immutably

- **WHEN** `GET /plugins/pi-dev-worktrees/dist/123.abc123.js` (hashed filename)
- **THEN** response SHALL include `Cache-Control: public, max-age=31536000, immutable`.

#### Scenario: Plugin not found returns 404

- **WHEN** `GET /plugins/nonexistent/remoteEntry.js` and no plugin with that id exists
- **THEN** server SHALL return 404 with `{ "error": "Plugin not found" }`.

### Requirement: localhostGuard gates plugin routes

The `/plugins/:id/*` route SHALL be gated by `localhostGuard`. Only loopback and trusted network requests SHALL be served. External IPs SHALL receive 403.

#### Scenario: Loopback request served

- **WHEN** `GET /plugins/pi-dev-worktrees/dist/remoteEntry.js` from `127.0.0.1`
- **THEN** server SHALL serve the file normally.

#### Scenario: External IP blocked

- **WHEN** same request from non-trusted external IP
- **THEN** server SHALL return 403.

### Requirement: Dev server override

When `PI_DASHBOARD_PLUGIN_DEV` env var is set (JSON map of `id → devServerUrl`), the server SHALL proxy `/plugins/<id>/*` to the plugin's dev server. Falls back to disk if dev server unreachable.

#### Scenario: Dev override proxies

- **WHEN** env var maps `pi-dev-worktrees` to `http://localhost:3456`
- **THEN** `GET /plugins/pi-dev-worktrees/dist/remoteEntry.js` SHALL be proxied to dev server.

#### Scenario: Dev server unreachable falls back

- **WHEN** dev override points to unreachable server
- **THEN** server SHALL log warning and serve from disk.

### Requirement: `PluginManifest` gains `mfRemote`

`PluginManifest` in `manifest-types.ts` SHALL gain optional `mfRemote: string` (path relative to manifest file). Server SHALL construct URL by prepending `/plugins/<id>/` to the manifest-relative path. `PluginStatus.mfRemote` SHALL contain the full URL. `GET /api/plugins` SHALL include it.

#### Scenario: Manifest with mfRemote

- **WHEN** manifest contains `"mfRemote": "./dist/remoteEntry.js"`
- **THEN** `PluginStatus.mfRemote` SHALL be `/plugins/<id>/dist/remoteEntry.js`.

### Requirement: Vite plugin excludes MF plugins

When the Vite plugin encounters a manifest with `mfRemote`, it SHALL skip generating a static import in `plugin-registry.tsx`. It SHALL add a comment noting the exclusion.

#### Scenario: MF plugin excluded from static registry

- **WHEN** workspace package has `mfRemote` in its manifest
- **THEN** generated `plugin-registry.tsx` SHALL have no import for that plugin and SHALL contain an exclusion comment.
