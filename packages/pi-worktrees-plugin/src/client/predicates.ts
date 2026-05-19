import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Extract text from a footer-segment decorator by key. */
function footerText(
  session: DashboardSession | null | undefined,
  key: string,
): string | undefined {
  const d = session?.uiDecorators?.[key];
  if (d?.kind === "footer-segment") return d.payload.text;
  return undefined;
}

/**
 * True iff the session has pi-worktrees active with a non-empty workspace state.
 * Drives the PiWorktreesBadge session-card chip.
 */
export function hasPiWorktrees(session: DashboardSession | null | undefined): boolean {
  const text = footerText(session, "footer-segment:pi-worktrees:workspace-state");
  return typeof text === "string" && text.length > 0;
}

export { footerText };
