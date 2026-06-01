# External Plugin Authoring Guide

Building dashboard plugins that load at runtime via Module Federation (MF).

## Overview

External plugins are standalone npm packages that build to MF remotes. Dashboard loads them dynamically without rebuild. Three discovery sources: workspace (`packages/*`), pi-installed (`~/.pi/agent/`), dashboard-installed (`~/.pi/dashboard/plugins/<id>/`).

Plugin authors build independently — no dashboard codebase needed. `dashboard-plugin-skill` scaffolds the skeleton.

## Scaffolding

Use `dashboard-plugin-skill mf-remote` to create a new external plugin:

```bash
pi-dashboard-plugin scaffold new
# Select mode: mf-remote
# Enter plugin id (kebab-case)
# Pick slots (multiselect)
# Choose: add server entry? add bridge entry?
```

Output: `<outDir>/<id>-plugin/` with `package.json`, `src/index.ts` entry, `rspack.config.ts`.

Alternatively, augment an existing pi extension to also export a dashboard plugin:

```bash
# In an existing extension repo
pi-dashboard-plugin scaffold augment
# Select mode: mf-augment
# Review proposed slot claims
# Confirm selections
```

Output: adds `rspack.config.ts` + `dashboard/` folder, mutates `package.json`.

## Build & Output

Rspack compiles to `dist/` with MF remote entry at `dist/remoteEntry.js`:

```bash
npm run build
# Output: dist/remoteEntry.js, dist/main.*.js, dist/*.css
```

Dev server with HMR:

```bash
npm run dev
# Runs on http://localhost:PORT (Rspack dev server)
```

Plugin authors build **before publishing**. Dashboard does NOT build plugins (server only serves pre-built bundles).

## Package Manifest

`package.json` declares the plugin via `pi-dashboard-plugin` field:

```json
{
  "name": "@scope/my-plugin",
  "version": "1.0.0",
  "pi-dashboard-plugin": {
    "id": "my-plugin",
    "displayName": "My Plugin",
    "priority": 100,
    "mfRemote": "./dist/remoteEntry.js",
    "claims": [
      { "slot": "session-card-badge", "component": "Badge" },
      { "slot": "session-card-action-bar", "component": "ActionButton" }
    ],
    "requiredApi": "^0.1.0",
    "server": "./src/server/index.ts",
    "bridge": "./src/bridge/index.ts",
    "configSchema": "./configSchema.json"
  }
}
```

Field meanings:
- `id`: unique plugin identifier (lowercase, dash-separated)
- `displayName`: UI label
- `priority`: slot-claim order (higher = earlier)
- `mfRemote`: path to MF remote entry (relative to package root; resolved by dashboard to `GET /plugins/<id>/dist/remoteEntry.js`)
- `claims`: array of slot contributions (component names are hints for authoring; init() receives real React components)
- `requiredApi`: minimum dashboard API version (semver range)
- `server` (optional): server-side entry point (dynamic import after installation)
- `bridge` (optional): pi extension integration
- `configSchema` (optional): JSON schema for plugin config UI

## Init Contract

Plugin exports `init(api)` from MF remote entry (`src/index.ts`):

```typescript
import Badge from './Badge';
import ActionButton from './ActionButton';
import type { DashboardPluginApi } from '@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/api';

export function init(api: DashboardPluginApi): void | (() => void) {
  const unreg1 = api.registerClaim({
    slot: 'session-card-badge',
    component: Badge
  });

  const unreg2 = api.registerClaim({
    slot: 'session-card-action-bar',
    component: ActionButton
  });

  // Optional cleanup function (called on plugin unload)
  return () => {
    unreg1();
    unreg2();
  };
}
```

Contract:
- `init(api)` called after import, before any claim is rendered
- Receives fully-typed `DashboardPluginApi`
- Register claims, subscriptions, event listeners in init()
- Return cleanup function (optional) — called on plugin unload or disable
- All subscriptions/listeners auto-unsubscribed on cleanup
- Errors in init() prevent plugin load (caught + logged)

## DashboardPluginApi Reference

### Session Access

```typescript
// Get single session by id
const session = api.getSession('session-id');
if (session) {
  console.log(session.name, session.currentDir);
}

// Get all sessions
const all = api.getAllSessions();

// Subscribe to session list changes
const unsub = api.subscribeSession((sessions) => {
  console.log(`${sessions.length} sessions available`);
});
// unsub() to stop listening
```

### Slot Registration

```typescript
// Register a component for a slot
const unregister = api.registerClaim({
  slot: 'session-card-badge',
  component: MyBadge,           // React component
  // slot-specific fields...
});
unregister(); // removes claim from slot
```

Slot taxonomy: `sidebar-folder-section`, `session-card-badge`, `session-card-action-bar`, `session-card-memory`, `session-card-flows`, `workspace-action-bar`, `content-view`, `content-header-sticky`, `content-inline-footer`, `anchored-popover`, `command-route`, `settings-section`, `tool-renderer`, `shell-overlay-route`.

For `tool-renderer` claims, include `toolName`:

```typescript
api.registerClaim({
  slot: 'tool-renderer',
  toolName: 'bash',
  component: BashRenderer,
  headerChips: (args) => [...],      // optional
  summary: (args) => 'summary text'  // optional
});
```

### Event Subscription

```typescript
// Listen for WebSocket events
const unsub = api.onEvent('session_created', (event) => {
  console.log('New session:', event);
});
unsub(); // stop listening
```

Common event types: `session_created`, `session_closed`, `session_running`, `plugin_config_changed`, `event_forward`.

### Notifications

```typescript
api.showToast('Operation complete', 'success');
// variants: 'info', 'success', 'warning', 'error' (default: 'info')
```

### Plugin Configuration

```typescript
// Read config (synchronous)
const config = api.getConfig<MyConfig>();
// Returns {} if not yet synced from server

// Write config (queued over WebSocket)
await api.setConfig({ theme: 'dark', verbosity: 2 });
// Server merges with existing config
// All connected plugins receive plugin_config_changed event
```

Optional: define schema in `configSchema.json` for dashboard UI to validate + present form.

### Plugin Metadata

```typescript
const id = api.pluginId;  // read-only: unique plugin id
```

## Slot Error Isolation

Each slot claim is wrapped in `SlotErrorBoundary`. If component throws:
- Error logged to console with plugin id + slot name
- In dev mode: red error pill rendered at claim location
- In production: nothing shown (graceful degradation)
- `plugin-load-error` CustomEvent dispatched (PluginStatusStore observes)
- Sibling claims in same slot unaffected

Render errors are isolated — broken plugins don't crash the dashboard.

## Shared Dependencies

Dashboard enforces singleton sharing for:
- `react` (v19)
- `react-dom` (v19)
- `@blackbelt-technology/dashboard-plugin-runtime` (shared runtime APIs)

MF remote declares these as shared with `singleton: true, requiredVersion: '^19.0.0'`. If plugin uses different version, warning logged but plugin still loads (single React tree). Avoid React version skew by pinning `^19.0.0`.

## Publishing to npm

1. Build plugin:
   ```bash
   npm run build
   ```

2. Add keyword `pi-dashboard-plugin` to `package.json`:
   ```json
   {
     "keywords": ["pi-dashboard-plugin"]
   }
   ```

3. Publish:
   ```bash
   npm publish
   ```

Plugin now discoverable via `GET /api/plugins/available?q=my-plugin` (searches npm for the keyword).

## Installation via Dashboard UI

1. Navigate to Dashboard → Settings → Plugins
2. Search npm for your plugin
3. Click "Install"
4. Dashboard fetches npm tarball, extracts to `~/.pi/dashboard/plugins/<id>/`
5. Rescans plugins, broadcasts `plugins_changed`
6. Dashboard loads plugin (~2s)

Server performs installation (not browser):

```bash
# CLI equivalent
curl -X POST http://localhost:8000/api/plugins/install \
  -H 'Content-Type: application/json' \
  -d '{"source": "npm:@scope/my-plugin"}'
```

Uninstall removes plugin directory + broadcasts `plugins_changed`:

```bash
curl -X POST http://localhost:8000/api/plugins/uninstall/my-plugin
```

## Optional: Server Entry

For plugins that need backend integration (database, external API, session coordination):

```typescript
// src/server/index.ts
import type { FastifyInstance } from 'fastify';

export async function registerPluginServer(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/my-plugin/action', async (req, reply) => {
    // Custom plugin endpoint
    return { result: 'ok' };
  });
}
```

Server entry is dynamic-imported after installation. Failure isolated — broken server entry does NOT crash dashboard. Register routes, middleware, or services. Access dashboard context via fastify instance.

## Optional: Bridge Entry

For plugins that integrate with pi extensions:

```typescript
// src/bridge/index.ts
import type { BridgeApi } from '@blackbelt-technology/pi-dashboard-shared/bridge-api';

export function registerBridge(api: BridgeApi): void | (() => void) {
  // Listen to extension events, dispatch bridge commands
  api.subscribe('myExtension/action', (payload) => {
    console.log('Extension sent:', payload);
  });

  api.dispatch('myExtension/response', { status: 'ok' });

  return () => {
    // Cleanup
  };
}
```

## Optional: Config Schema

Define validation + UI hints via JSON schema:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": ["light", "dark"],
      "default": "light"
    },
    "verbosity": {
      "type": "number",
      "minimum": 0,
      "maximum": 5,
      "default": 2
    },
    "apiKey": {
      "type": "string",
      "description": "External API key (optional)"
    }
  }
}
```

Dashboard uses schema to validate + present form in Plugins UI.

## Development Workflow

Dev mode with Rspack HMR + dashboard proxy:

```bash
# Terminal 1: plugin dev server
cd my-plugin
npm run dev
# Rspack listens on http://localhost:3456

# Terminal 2: dashboard with dev override
cd pi-agent-dashboard
PI_DASHBOARD_PLUGIN_DEV='{"my-plugin":"http://localhost:3456"}' npm run dev
```

Dashboard proxies `/plugins/my-plugin/*` requests to http://localhost:3456. Edit plugin source, Rspack rebuilds, MF cache invalidated, plugin reloads (~500ms).

Testing plugin in isolation:

```bash
npm run build
npm run test  # vitest (if test suite exists)
```

## Release Checklist

- [ ] Build succeeds (`npm run build`)
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] Tests pass (`npm run test`)
- [ ] `dashboard-plugin.json` in `package.json` is valid
- [ ] `mfRemote` points to real file in `dist/`
- [ ] `requiredApi` version range covers dashboard version
- [ ] `README.md` documents slot contributions + features
- [ ] Shared deps pinned to `^19.0.0` (React, dom, runtime)
- [ ] Keyword `pi-dashboard-plugin` added
- [ ] Version bumped (semver)
- [ ] Built artifacts committed OR `.gitignore` excludes `dist/`

Publish:

```bash
npm publish
```

After publish, plugin appears in npm search within ~10 minutes. Dashboard users can search + install immediately.

## Troubleshooting

### Plugin not loading
- Check dev console: `[plugin-loader]` errors logged with details
- Verify `mfRemote` URL resolves (test `curl GET /plugins/<id>/dist/remoteEntry.js`)
- Confirm `init()` export exists in remote entry
- Check PluginStatusStore UI (Plugins section) for load errors

### Plugin renders with red error pill
- Dev-mode only; shows plugin id + slot name
- Check browser console for exception stack trace
- Verify component prop types match slot usage
- Test component in isolation with mock api

### Config not persisting
- Call `await api.setConfig(...)` (promise-based)
- Verify plugin-scoped config received via `plugin_config_changed` event
- Check server logs for `set_plugin_config` errors

### Shared dependency conflicts
- Rspack config declares React + dom as `singleton: true`
- If conflict, both versions loaded (MF fallback); warning in console
- Ensure `package.json` pins React to `^19.0.0`

### Dev server not updating
- Set `PI_DASHBOARD_PLUGIN_DEV` env var with correct URL
- Verify plugin dev server running on specified port
- Check `/plugins/<id>/dist/remoteEntry.js` returns valid JS (curl it)
- Try clearing browser cache + full page reload

## More Info

- `docs/plugin-architecture.md` — dashboard plugin system internals
- `packages/dashboard-plugin-skill` — scaffold command source
- `packages/dashboard-plugin-runtime` — API client + SlotRegistry
- `packages/client/src/lib/plugin-loader.ts` — runtime loader
- Design doc: `openspec/changes/runtime-plugin-loading/design.md`
