## Context

Dashboard frontend currently emits two different slash-command families for OpenSpec actions:

- **Explore** uses `/skill:openspec-explore` (skill route).
- **New / Continue / FF / Apply / Verify / Archive** use `/opsx:<verb>` (prompt-template route).

The two routes execute *almost* the same workflow, but only the skill route runs `.pi/skills/openspec-shared/scripts/effective-status.sh`, which applies the dashboard's design-evidence override (R1/R2/R3 promotion). The prompt-template route calls raw `openspec status`. Result: dashboard buttons can claim an artifact is "next ready" while the agent invoked through `/opsx:apply` reports it as "blocked".

Affected files (only call sites — labels, icons, disabled-state logic stay identical):

| File | `/opsx:` sites |
|---|---|
| `packages/client/src/components/SessionOpenSpecActions.tsx` | continue, ff, apply, verify, archive (×2) |
| `packages/client/src/components/MobileActionMenu.tsx` | continue, ff, apply, verify, archive |
| `packages/client/src/components/NewChangeDialog.tsx` | new (4 string permutations) |

`.pi/prompts/opsx-*.md` templates remain in place — users who type `/opsx:apply` manually still get the legacy path.

## Goals / Non-Goals

**Goals:**

- Single source of truth for dashboard-emitted OpenSpec slash commands: the skills.
- Dashboard buttons and the agent that runs them agree on artifact readiness (`effective-status.sh`).
- Zero UI-visible change: same labels, icons, disabled rules, payload (attached change name, optional newline-prefixed user text).

**Non-Goals:**

- Removing `.pi/prompts/opsx-*.md`. They stay as user-typed shortcuts.
- Re-implementing `effective-status.sh` inside the prompt templates.
- Changing skill behaviour, names, or arguments.
- Touching server, extension, or shared protocol code.
- Migrating pi's own slash-command parser.

## Decisions

### D1 — Direct string replacement, no abstraction layer

Each call site swaps the literal string `/opsx:<verb>` → `/skill:openspec-<verb>-change`. No central "OpenSpec command builder" helper.

**Rationale**: 11 call sites across 3 files. A helper would add indirection for a one-time mechanical change. DRY rule (AGENTS.md §2): extract only when the same pattern appears more than once and we can't see all sites at edit time. We can.

**Alternative considered**: a `buildOpenSpecCommand(verb, args)` helper. Rejected — speculative abstraction, harder grep, no second consumer.

### D2 — Skill verb naming

| Prompt | Skill |
|---|---|
| `/opsx:new` | `/skill:openspec-new-change` |
| `/opsx:continue` | `/skill:openspec-continue-change` |
| `/opsx:ff` | `/skill:openspec-ff-change` |
| `/opsx:apply` | `/skill:openspec-apply-change` |
| `/opsx:verify` | `/skill:openspec-verify-change` |
| `/opsx:archive` | `/skill:openspec-archive-change` |

Mapping verified against `.pi/skills/openspec-*/SKILL.md` directories. Explore stays at `/skill:openspec-explore` (already correct).

### D3 — Argument format unchanged

`/skill:` invocations accept the same trailing positional args as the prompt form: `/skill:openspec-apply-change <change-name>`, `/skill:openspec-explore <change-name>\n<user-text>`. The Explore wiring already proves this works end-to-end.

### D4 — Tests assert the new strings

Every `__tests__/*.test.tsx` that currently asserts `/opsx:` text gets updated to assert `/skill:openspec-*-change`. No new test files. Test count and structure unchanged.

## Risks / Trade-offs

- **[Risk]** A pi build that lacks the `openspec-*-change` skills would silently fall through to the agent's free-form interpretation of the prompt → confusing behaviour.
  **Mitigation**: All eight skills already exist in `.pi/skills/` and ship with the repo (`ls .pi/skills/openspec-*-change`). Add a CI lint asserting skill directories exist for every verb the frontend emits.

- **[Risk]** Slight prompt-length increase per click (`/skill:openspec-apply-change` is 26 chars vs 11 for `/opsx:apply`).
  **Mitigation**: Negligible — token cost is dominated by skill body load, not the slash command itself.

- **[Trade-off]** Two routes coexist (skill for buttons, prompt for typed shortcuts). Keeps user habit intact at the cost of two code paths.
  **Mitigation**: Deferred. A follow-up proposal can deprecate `/opsx:` prompts after a quiet period if telemetry shows no manual use.

## Migration Plan

1. Edit the 3 components → flip strings.
2. Update the 3 test files → assert new strings.
3. `npm run build` + `curl -X POST http://localhost:8000/api/restart` (per AGENTS.md "After client changes" workflow).
4. Smoke-test each button on a session card with an attached proposal.

No rollback hazard — the change is text-replacement-only and reversible by `git revert`.

## Open Questions

- None. Mapping is mechanical and skills are already present.
