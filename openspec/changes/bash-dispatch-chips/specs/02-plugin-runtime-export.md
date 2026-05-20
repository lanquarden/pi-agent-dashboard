# Spec: Export registerToolRenderer from plugin runtime

## File
`packages/dashboard-plugin-runtime/src/index.ts`

## Change
Export `registerToolRenderer` from the plugin runtime barrel so plugins can replace built-in tool renderers.

## Background
`registerToolRenderer(toolName, Component)` registers a replacement renderer for a given tool name. When a tool card renders, the client checks for a registered replacement before falling back to the built-in renderer. Plugins loaded via Vite share the same module graph — a plugin calling `registerToolRenderer` at module-load time writes into the same registry the client reads.

## What to export
```ts
export { registerToolRenderer, getToolRenderer } from "<tool-renderer-registry-path>";
export type { ToolRendererProps } from "<tool-renderer-types-path>";
```

## Plugin usage pattern
```ts
// in plugin client entry
import { registerToolRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EnhancedBashToolRenderer } from "./EnhancedBashToolRenderer.js";

registerToolRenderer("bash", EnhancedBashToolRenderer);
```

Called at module load. No React lifecycle needed — plain Map write.

## Test
- Import `registerToolRenderer` from barrel; assert function
- Register renderer for `"bash"` → `getToolRenderer("bash")` returns it
- `getToolRenderer("unknown")` returns `undefined` (falls back to built-in)
