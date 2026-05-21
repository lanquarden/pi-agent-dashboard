# Spec: Bridge notify opts alignment

> **Status**: Reverted. This implementation was removed — the bash-dispatch-chips feature uses `event_forward` only (zero bridge changes). Spec retained for reference.

## File
`packages/extension/src/bridge.ts`

## Change (not applied)
Align `ctx.ui.notify` patch with `select`/`input`/`confirm`/`editor`/`multiselect` — all accept `opts` and thread `toolCallId` through `buildMeta`.

## Why reverted
Bash-dispatch-chips pivoted to `event_forward` (simpler, zero bridge dependency). The notify opts extension was not needed and introduced unnecessary complexity.
