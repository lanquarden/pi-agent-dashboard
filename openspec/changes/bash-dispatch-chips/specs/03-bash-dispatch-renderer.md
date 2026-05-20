# Spec: Generic tool-row enrichment + registerToolRenderer export

## Files (this repo)
- `packages/client/src/lib/event-reducer.ts` — generic `event_forward` enrichment handler
- `packages/dashboard-plugin-runtime/src/index.ts` — export `registerToolRenderer`, `getToolRenderer`, `ToolRendererProps`

## Background

Plugins need a way to attach metadata to tool rows at render time, and to replace built-in tool renderers. Both mechanisms live in this repo. The plugin-specific rendering code lives in the plugin's own repo (e.g. `~/.pi/dashboard/plugins/pi-dev-worktrees/`).

## 1. Generic tool-row enrichment (event-reducer.ts)

### What

Any `event_forward` message whose `data` contains a `toolCallId` string is treated as a plugin enrichment for that tool row. No plugin-specific code in core.

### Reducer logic

```ts
// In event_forward handler:
if (data && typeof data.toolCallId === "string") {
  const { toolCallId, ...enrichment } = data;
  // Find matching tool row → patch args._pluginData[eventType]
  // Row not yet created → buffer in pendingEnrichments
}

// In tool_execution_start handler:
// Flush pending enrichments for this toolCallId into args._pluginData
```

### State additions

```ts
interface SessionState {
  // ...
  pendingEnrichments: Map<string, Map<string, unknown>>;
  // Key: toolCallId, Value: Map<eventType, enrichment data>
}
```

### Semantics

- Payload stored at `args._pluginData[eventType]` — namespaced by event type
- Multiple plugins annotate same row independently (no collision)
- If tool row not yet created when `event_forward` arrives: buffered in `pendingEnrichments`; applied when `tool_execution_start` creates the row
- Cap: 20 entries in `pendingEnrichments` to prevent unbounded growth from buggy plugins
- LLM-originated `event_forward` events without `toolCallId` are unaffected (no-op for this path)

## 2. Export registerToolRenderer (dashboard-plugin-runtime)

### What

`registerToolRenderer(toolName, Component)` registers a replacement renderer for a tool name. `getToolRenderer(toolName)` returns the registered component or `undefined`.

### Export from barrel

```ts
export { registerToolRenderer, getToolRenderer } from "<tool-renderer-registry-path>";
export type { ToolRendererProps } from "<tool-renderer-types-path>";
```

### Plugin usage

```ts
// In plugin client entry (module-load time, no React lifecycle needed)
import { registerToolRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EnhancedBashToolRenderer } from "./EnhancedBashToolRenderer.js";

registerToolRenderer("bash", EnhancedBashToolRenderer);
```

### ToolRendererSlot

`ToolRendererSlot` in `slot-consumers.tsx` checks `getToolRenderer(toolName)` before falling back to built-in renderer. Plugin renderer receives same props as built-in; reads `args._pluginData?.["plugin-id:event-name"]` for enrichment data.

## Tests

- [x] `registerToolRenderer` importable from barrel
- [x] `getToolRenderer` returns registered component
- [ ] Reducer: `event_forward` with `toolCallId` patches correct tool row's `args._pluginData[eventType]`
- [ ] Reducer: `event_forward` arriving before row → buffered in `pendingEnrichments`, applied on `tool_execution_start`
- [ ] Reducer: unknown `eventType` with no `toolCallId` → no-op
- [ ] Reducer: `pendingEnrichments` cap at 20 evicts oldest
