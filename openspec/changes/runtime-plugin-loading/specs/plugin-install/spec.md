## ADDED Requirements

### Requirement: Server installs plugins from npm

The server SHALL provide `POST /api/plugins/install { source: "npm:<pkg>" }`. It SHALL: resolve the package from npm (reuse existing `npm-search-proxy` plumbing), download the tarball, extract to `~/.pi/dashboard/plugins/<id>/`, read the manifest from `dashboard-plugin.json` in the extracted package, register the plugin in `PluginStatusStore`, and broadcast `plugins_changed`. Extraction SHALL be atomic — extract to a temp dir, then rename into place.

`POST /api/plugins/uninstall/:id` SHALL remove `~/.pi/dashboard/plugins/<id>/` and broadcast `plugins_changed`.

`GET /api/plugins/available?q=<search>` SHALL search npm for packages with `pi-dashboard-plugin` keyword, reusing `npm-search-proxy`.

#### Scenario: Install plugin from npm

- **WHEN** `POST /api/plugins/install { source: "npm:@lanquarden/pi-dev-worktrees-dashboard-plugin" }`
- **THEN** server SHALL download tarball, extract to `~/.pi/dashboard/plugins/pi-dev-worktrees/`, read manifest, broadcast `plugins_changed` with new plugin.

#### Scenario: Uninstall removes directory

- **WHEN** `POST /api/plugins/uninstall/pi-dev-worktrees`
- **THEN** `~/.pi/dashboard/plugins/pi-dev-worktrees/` SHALL be removed, `plugins_changed` broadcast without that plugin.

#### Scenario: Failed install cleans up

- **WHEN** npm tarball download fails mid-way
- **THEN** temp directory SHALL be cleaned up. `PluginStatusStore` SHALL NOT be updated. No broadcast.

### Requirement: Plugin discovery scans `~/.pi/dashboard/plugins/`

`discoverPlugins()` SHALL scan `~/.pi/dashboard/plugins/<id>/dashboard-plugin.json` for manifests, in addition to workspace (`packages/*/`) and pi-installed package sources. This is additive. Discovery order: workspace first, then pi-installed, then dashboard-installed. Later sources are shadowed by earlier ones with the same plugin id.

`PluginStatus.source` SHALL be `"dashboard-installed"` for plugins from this source.

#### Scenario: Dashboard-installed plugin discovered

- **WHEN** `~/.pi/dashboard/plugins/pi-dev-worktrees/dashboard-plugin.json` exists
- **THEN** `discoverPlugins()` SHALL include it. `source` SHALL be `"dashboard-installed"`.

#### Scenario: Same id in workspace shadows dashboard-installed

- **WHEN** plugin "honcho" exists in both `packages/honcho-plugin/` and `~/.pi/dashboard/plugins/honcho/`
- **THEN** workspace version SHALL win. Dashboard version SHALL have `loaded: false` and error "Shadowed by workspace plugin."

### Requirement: Install UI in PluginsSection

`<PluginsSection>` SHALL expose an install input: text field for npm package name, "Install" button, search results from `GET /api/plugins/available`, and progress feedback during download/extraction. Installed plugins SHALL appear in the plugin list immediately after the `plugins_changed` broadcast.

#### Scenario: User installs via UI

- **WHEN** user types `pi-dev-worktrees-dashboard-plugin` in the search field and clicks Install
- **THEN** progress indicator SHALL show during install. On completion, plugin SHALL appear in the list without page refresh.

#### Scenario: Search shows available plugins

- **WHEN** user types `worktree` in the search field
- **THEN** results from `GET /api/plugins/available?q=worktree` SHALL display with name, description, and version.
