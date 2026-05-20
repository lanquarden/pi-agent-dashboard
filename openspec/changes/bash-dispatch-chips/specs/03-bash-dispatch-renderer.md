# Spec: BashDispatchRenderer

## Files
- `packages/pi-dev-worktrees-plugin/src/client/BashDispatchRenderer.tsx` (new)
- `packages/pi-dev-worktrees-plugin/src/client/index.tsx` (add registration call)
- `packages/pi-dev-worktrees-plugin/src/client/__tests__/BashDispatchRenderer.test.tsx` (new)

## Purpose
In-flight replacement card for the standard bash tool card. Appears while a bash command is executing; auto-dismissed by the suppression mechanism when the tool result arrives.

## Payload type

The `params` prop (`Record<string, unknown>`) carries `_promptBusComponent.props` containing:

```ts
interface BashDispatchPayload {
  llmCommand: string;       // original command as written by the LLM
  rtkRewritten: boolean;    // true if RTK mutated the command
  rtkCommand?: string;      // post-RTK command (only when rtkRewritten)
  routing: "host" | "container" | "error";
  errorMessage?: string;    // only when routing === "error"
}
```

Parsed from `params._promptBusComponent?.props` (same pattern as `NotifyRenderer`).

## Rendering

### `status === "pending"` (command in flight)
Full replacement card. Matches the width/padding of a standard bash tool card so the layout doesn't shift on dismiss.

```
┌──────────────────────────────────────────────────────────┐
│ $ <llmCommand>                              [chip] [chip] │
└──────────────────────────────────────────────────────────┘
```

**Chips (right-aligned, gap-1.5):**

| Condition | Chip | Colour | Tooltip |
|---|---|---|---|
| `rtkRewritten === true` | `RTK` | amber-400 pill | `rtkCommand` |
| `routing === "container"` | `container` | blue-400 pill | none |
| `routing === "host"` | `host` | muted (text-secondary) pill | none |
| `routing === "error"` | `error` | red-400 pill | `errorMessage` |

Host chip only rendered when `routing === "host"` AND a devcontainer is configured in the session (detected via `params._promptBusComponent?.props?.hasDevcontainer === true` — set by pi-dev-worktrees extension). Rationale: in sessions without a devcontainer the routing context is obvious and a `host` chip adds noise.

### `status !== "pending"` (resolved / cancelled / dismissed)
Render `null`. The standard bash card reappears in history as-is.

## Registration

In `packages/pi-dev-worktrees-plugin/src/client/index.tsx`, add at module top level (after imports):

```ts
import { registerInteractiveRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { BashDispatchRenderer } from "./BashDispatchRenderer.js";

registerInteractiveRenderer("bash-dispatch", BashDispatchRenderer);
```

## Styling notes
- Outer `div`: `mx-4 my-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-sm font-mono flex items-center gap-2`
- Command text: `flex-1 truncate text-[var(--text-primary)]` with `$` prefix in `text-[var(--text-secondary)]`
- Chips: `inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans`
- RTK: `bg-amber-400/15 text-amber-400`
- Container: `bg-blue-400/15 text-blue-400`
- Host: `bg-[var(--bg-quaternary)] text-[var(--text-secondary)]`
- Error: `bg-red-400/15 text-red-400`
- Match visual language of `PiDevWorktreesBadge` and `NotifyRenderer`

## Tests: `BashDispatchRenderer.test.tsx`
- `status="pending"` + `routing="container"` → shows container chip, no host chip
- `status="pending"` + `routing="host"` + `hasDevcontainer=true` → shows host chip
- `status="pending"` + `routing="host"` + `hasDevcontainer=false` → no host chip
- `status="pending"` + `rtkRewritten=true` + `rtkCommand="rtk grep …"` → shows RTK chip; chip title attribute = rtkCommand
- `status="pending"` + `routing="error"` + `errorMessage="…"` → shows error chip; chip title = errorMessage
- `status="resolved"` → renders null
- `status="cancelled"` → renders null
- Missing / malformed params → renders null gracefully (no throw)
