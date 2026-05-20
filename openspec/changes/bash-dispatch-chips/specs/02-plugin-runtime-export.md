# Spec: Export registerInteractiveRenderer from plugin runtime

## File
`packages/dashboard-plugin-runtime/src/index.ts`

## Change
Re-export `registerInteractiveRenderer` and `InteractiveRenderer` type from the plugin runtime barrel so that plugins can register custom tool-card renderers without importing from the core client bundle.

## Background
`registerInteractiveRenderer(method, renderer)` already exists in:
```
packages/client/src/components/interactive-renderers/registry.ts
```

The function is used by `ChatView.tsx` via `getInteractiveRenderer(method)`. It operates on a module-level `Map<string, InteractiveRenderer>`. Because plugin client code and dashboard client code share the same module graph at runtime (plugins are loaded via Vite's plugin-registry.tsx), a plugin calling `registerInteractiveRenderer` at module-load time writes into the same map that `ChatView.tsx` reads — no bridge or side-channel needed.

## What to add to `packages/dashboard-plugin-runtime/src/index.ts`
```ts
export { registerInteractiveRenderer } from
  "../../client/src/components/interactive-renderers/registry.js";
export type { InteractiveRenderer, InteractiveRendererProps } from
  "../../client/src/components/interactive-renderers/types.js";
```

The relative import path is intentional — at build time the plugin runtime and client are co-located in the monorepo. At runtime in the browser, Vite resolves this to the same singleton module.

## Plugin usage pattern
```ts
// in plugin client entry (e.g. packages/pi-dev-worktrees-plugin/src/client/index.tsx)
import { registerInteractiveRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { BashDispatchRenderer } from "./BashDispatchRenderer.js";

registerInteractiveRenderer("bash-dispatch", BashDispatchRenderer);
```

Called at module load. No React lifecycle needed — `registerInteractiveRenderer` is a plain Map write.

## Test: `packages/dashboard-plugin-runtime/src/__tests__/interactive-renderer-registration.test.ts`
- Import `registerInteractiveRenderer` from the barrel; assert it is a function
- Register a dummy renderer for `"test-method"` and call `getInteractiveRenderer("test-method")` from the registry — assert it returns the registered component
- Assert `getInteractiveRenderer("unknown-method")` still returns `GenericInteractiveRenderer` (fallback unchanged)
