# Spec: Tool renderer header chips

## Problem

`ToolCallStep.tsx` renders a collapsed header row (status icon + summary + elapsed badge). When the old hardcoded `BashDispatchChips` component was removed from the core (commit b8105d11), plugins lost the ability to inject inline chips into this header. The `EnhancedBashToolRenderer` in the plugin only controls the **expanded body** — the collapsed header has no extension point.

## Solution

Extend `registerToolRenderer` with an optional `opts` parameter that includes a `headerChips` function. `ToolCallStep` calls this function in the header row when rendering the collapsed summary line.

## API

### registry.ts

```ts
/** Function returning ReactNode chips for the collapsed tool header */
export type HeaderChipsFn = (args?: Record<string, unknown>) => React.ReactNode;

const headerChipsRegistry = new Map<string, HeaderChipsFn>();

export function registerToolRenderer(
  toolName: string,
  renderer: ToolRenderer,
  opts?: { headerChips?: HeaderChipsFn },
): void {
  renderers.set(toolName, renderer);
  if (opts?.headerChips) {
    headerChipsRegistry.set(toolName, opts.headerChips);
  }
}

export function getToolHeaderChips(toolName: string): HeaderChipsFn | undefined {
  return headerChipsRegistry.get(toolName);
}
```

### ToolCallStep.tsx

```tsx
import { getToolRenderer, getToolHeaderChips, type ToolContext } from "./tool-renderers/index.js";

// In header button, after summary text, before ElapsedBadge:
{getToolHeaderChips(toolName)?.(args)}
```

### Plugin usage (pi-dev-worktrees)

```ts
import { registerToolRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EnhancedBashToolRenderer, renderBashDispatchChips } from "./EnhancedBashToolRenderer.js";

registerToolRenderer("bash", EnhancedBashToolRenderer, {
  headerChips: renderBashDispatchChips,
});
```

## Files changed (this repo)

| File | Change |
|------|--------|
| `packages/client/src/components/tool-renderers/registry.ts` | Add `HeaderChipsFn` type, `headerChipsRegistry` map, `getToolHeaderChips`, extend `registerToolRenderer` signature |
| `packages/client/src/components/tool-renderers/types.ts` | Export `HeaderChipsFn` type |
| `packages/client/src/components/tool-renderers/index.ts` | Re-export `getToolHeaderChips`, `HeaderChipsFn` |
| `packages/client/src/components/ToolCallStep.tsx` | Import + render `getToolHeaderChips(toolName)?.(args)` in header |
| `packages/dashboard-plugin-runtime/src/index.ts` | Re-export `HeaderChipsFn` type |

## Files changed (plugin repo: pi-dev-worktrees)

| File | Change |
|------|--------|
| `packages/pi-dev-worktrees-dashboard-plugin/src/client/EnhancedBashToolRenderer.tsx` | Extract + export `renderBashDispatchChips` function |
| `packages/pi-dev-worktrees-dashboard-plugin/src/client/index.tsx` | Pass `{ headerChips: renderBashDispatchChips }` in registration |

## Tests

- `registerToolRenderer("bash", Renderer, { headerChips: fn })` → `getToolHeaderChips("bash")` returns `fn`
- `registerToolRenderer("bash", Renderer)` (no opts) → `getToolHeaderChips("bash")` returns `undefined`
- Overwriting: second `registerToolRenderer("bash", R2, { headerChips: fn2 })` replaces first
