## Why

Dashboard frontend buttons currently emit `/opsx:<verb>` slash-prompt commands (e.g. `/opsx:apply`, `/opsx:archive`) for every OpenSpec action except Explore. Those prompt templates are the **older, dashboard-unaware** path: they call raw `openspec status` and miss the dashboard's design-evidence override (`effective-status.sh`, R1/R2/R3 promotion). The skills (`/skill:openspec-<verb>-change`) are the canonical, maintained surface and the only path that uses `effective-status.sh`. Today's mix is inconsistent (Explore already routes to the skill) and produces "blocked" states the dashboard's own UI says are ready.

## What Changes

- Replace every `/opsx:<verb>` prompt emission in dashboard frontend code with the equivalent `/skill:openspec-<verb>-change` invocation:
  - `/opsx:new` → `/skill:openspec-new-change`
  - `/opsx:continue` → `/skill:openspec-continue-change`
  - `/opsx:ff` → `/skill:openspec-ff-change`
  - `/opsx:apply` → `/skill:openspec-apply-change`
  - `/opsx:verify` → `/skill:openspec-verify-change`
  - `/opsx:archive` → `/skill:openspec-archive-change`
- Update affected components: `SessionOpenSpecActions.tsx`, `MobileActionMenu.tsx`, `NewChangeDialog.tsx`.
- Update the matching `__tests__/*.test.tsx` expectations to assert the skill form.
- Leave the `.pi/prompts/opsx-*.md` files in place — users can still type `/opsx:apply` manually. This change is **frontend-only**; no removal of prompt templates.
- Do **not** change Explore wiring (already on `/skill:openspec-explore`).

No BREAKING changes for end users: button labels, icons, and disabled-state logic are unchanged. Only the emitted slash command differs.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `openspec-frontend-actions`: spec covers which slash command each dashboard OpenSpec button emits. Requirement changes from "emits `/opsx:<verb>`" to "emits `/skill:openspec-<verb>-change`" for new/continue/ff/apply/verify/archive. Explore unchanged.

## Impact

- **Code**: 3 client components + 3 test files in `packages/client/src/components/`.
- **Behaviour**: Apply/Verify/Archive/Continue/FF/New now use `effective-status.sh` (R1/R2/R3 design-evidence override), matching what the dashboard buttons themselves report as "next ready". Resolves spurious "blocked" states.
- **No server, extension, or shared-protocol changes.**
- **Prompt templates `/opsx:*` remain available** as user shortcuts; only the dashboard-emitted strings change.
- **Docs**: AGENTS.md and `docs/file-index-client.md` rows for the three components get a one-line "skill-routed" annotation per the Documentation Update Protocol.
