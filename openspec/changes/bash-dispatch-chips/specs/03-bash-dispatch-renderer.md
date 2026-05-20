# Spec: EnhancedBashToolRenderer + Client Reducer

## Files
- `packages/pi-dev-worktrees-plugin/src/client/EnhancedBashToolRenderer.tsx` (new)
- `packages/pi-dev-worktrees-plugin/src/client/index.tsx` (add registration)
- Client event reducer (patch tool row on event_forward)

## Data flow

1. pi-dev-worktrees emits `pi.events.emit("pi-dev-worktrees:bash-dispatch", payload)`
2. Bridge forwards as `event_forward { eventType, data }` automatically
3. Client reducer matches `eventType === "pi-dev-worktrees:bash-dispatch"`
4. Reducer extracts `toolCallId` from `data`, finds matching tool row, sets `row.args._dispatch = data`
5. `EnhancedBashToolRenderer` reads `args._dispatch` and renders chips

## Payload type (in `args._dispatch`)

```ts
interface BashDispatchData {
  toolCallId: string;
  llmCommand: string;
  rtkRewritten: boolean;
  rtkCommand?: string;
  routing: "host" | "container" | "error";
  hasDevcontainer: boolean;
  errorMessage?: string;
}
```

## Client reducer patch

In the event reducer handling `event_forward`:

```ts
if (event.eventType === "pi-dev-worktrees:bash-dispatch") {
  const { toolCallId, ...dispatch } = event.data;
  // Find tool row with matching toolCallId, patch args._dispatch
}
```

## EnhancedBashToolRenderer

Registered via `registerToolRenderer("bash", EnhancedBashToolRenderer)`.

### Behaviour
- Reads `args._dispatch` from props
- When `_dispatch` present: renders chip row + delegates to original `BashToolRenderer`
- When `_dispatch` absent: delegates to `BashToolRenderer` unchanged (transparent passthrough)

### Chip rendering

| Condition | Chip | Colour | Tooltip |
|---|---|---|---|
| `rtkRewritten === true` | `RTK` | amber-400 pill | `rtkCommand` |
| `routing === "container"` | `container` | blue-400 pill | — |
| `routing === "host"` AND `hasDevcontainer === true` | `host` | muted pill | — |
| `routing === "error"` | `error` | red-400 pill | `errorMessage` |

Host chip only shown when devcontainer is configured. Without devcontainer, routing is always host — chip adds no information.

### Styling
- Chips: `inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans`
- RTK: `bg-amber-400/15 text-amber-400`
- Container: `bg-blue-400/15 text-blue-400`
- Host: `bg-[var(--bg-quaternary)] text-[var(--text-secondary)]`
- Error: `bg-red-400/15 text-red-400`

## Registration

In `packages/pi-dev-worktrees-plugin/src/client/index.tsx`:

```ts
import { registerToolRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EnhancedBashToolRenderer } from "./EnhancedBashToolRenderer.js";

registerToolRenderer("bash", EnhancedBashToolRenderer);
```

## Tests: `EnhancedBashToolRenderer.test.tsx`
- `_dispatch.routing="container"` → container chip shown
- `_dispatch.routing="host"` + `hasDevcontainer=true` → host chip shown
- `_dispatch.routing="host"` + `hasDevcontainer=false` → no host chip
- `_dispatch.rtkRewritten=true` + `rtkCommand` → RTK chip with title
- `_dispatch.routing="error"` + `errorMessage` → error chip with title
- No `_dispatch` in args → renders BashToolRenderer unchanged, no chips

## Tests: reducer
- `event_forward` with matching `eventType` → patches correct tool row's `args._dispatch`
- Unknown `eventType` → no patch
- Missing `toolCallId` in payload → no patch
