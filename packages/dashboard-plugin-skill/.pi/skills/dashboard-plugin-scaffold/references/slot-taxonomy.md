# Slot Taxonomy

The 10 React-accepting slots a dashboard plugin can claim. Frozen for v0.x.

For the full slot table including descriptor-only slots (`management-modal`, `footer-segment`, `agent-metric`, `breadcrumb`, `gate`, `toast`, `rjsf-form`), see the archived design at `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` § "Slot taxonomy".

| Slot id | Multiplicity | Lifetime | When to use |
|---|---|---|---|
| `sidebar-folder-section` | many per folder | persistent | Collapsible block above the session list per workspace folder. Use for folder-scoped tools (e.g. OpenSpec change browser per folder). |
| `session-card-badge` | many per session | persistent | Compact info chip in the session card header. Use for at-a-glance status (e.g. OpenSpec activity badge, flow activity badge). |
| `session-card-action-bar` | many per session | persistent | Action buttons in the session card footer. Use for per-session actions (e.g. attach proposal, launch flow). |
| `content-view` | one active per session | persistent | Full-screen content area replacing the chat view. Use for rich content browsers (e.g. archive browser, specs browser). Pair with a `command-route` claim. |
| `content-header-sticky` | many per session | persistent | Sticky element above the content view. Use for breadcrumbs, action bars (e.g. flow architect bar). |
| `content-inline-footer` | many per session | persistent | Inline element below the content view, above the chat input. Use for status summaries (e.g. flow summary). |
| `anchored-popover` | one at a time | one-shot | Popover anchored to a triggering UI element. Use for transient detail (e.g. tasks popover). |
| `command-input-action` | many | persistent | Renders action buttons in the CommandInput button row (before Send/Stop). Session-scoped with `onInsertText(text)` callback. |
| `command-route` | many globally | persistent | Maps a slash command (`/specs`) or URL route to a `content-view` claim. The `command` field names the slash command; the `component` field names the content-view component. |
| `settings-section` | many globally | persistent | A section in the dashboard's Settings page. Use for plugin config UI. Use `usePluginConfig<T>()` to read; `pluginRouter.send({ type: "plugin_config_write", id, config })` to write. |
| `tool-renderer` | many globally | persistent | A custom React component rendering `tool_call` events with a specific `toolName`. Use to give a tool richer rendering than the default tool card. The `toolName` field selects which tool. |

## Prop contracts

Every claimed component receives `SlotProps<SlotId>` from `@blackbelt-technology/pi-dashboard-shared`:

```ts
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props";

// Example: a session-card-badge claim
export function MyBadge(props: SlotProps<"session-card-badge">) {
  // props.session: DashboardSession
  // props.pluginContext: PluginContext
  return <span>…</span>;
}

// Example: a content-view claim
export function MyView(props: SlotProps<"content-view">) {
  // props.session: DashboardSession
  // props.routeParams: Record<string, string>
  // props.pluginContext: PluginContext
  return <div>…</div>;
}
```

Refer to `packages/shared/src/dashboard-plugin/slot-props.ts` in the dashboard repo for the full prop type per slot.

## Multiplicity and ordering

- "one active per session" / "one at a time": the active route or most-recent show wins; collisions on the same key (route pattern, trigger id) are a load-time error.
- "many ...": all claims render. Order = `priority` (lower first), then alphabetical plugin id.

## Conflict examples

Two plugins claim `command-route` with `command: "/specs"` → load-time error, both plugins flagged failed via `/api/health.plugins[]`.

Two plugins claim `session-card-badge` → both render in priority order. No conflict.

Two plugins claim `content-view` with non-overlapping `command-route`s → both fine; the active route picks the winner per session.

## When in doubt

- Want to render an at-a-glance indicator? `session-card-badge`.
- Want to add an action button? `session-card-action-bar`.
- Want a full-screen view tied to a slash command? `content-view` + `command-route` (paired).
- Want to add to the Settings page? `settings-section`.
- Want a richer tool result card? `tool-renderer`.

If your need doesn't fit any of the 10 slots, the slot taxonomy is frozen — adding a new slot requires an OpenSpec change proposal against `dashboard-shell-slots`.
