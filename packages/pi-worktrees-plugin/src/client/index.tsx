/**
 * Client entry barrel for the pi-worktrees-plugin.
 *
 * Component slots claimed by `pi-dashboard-plugin` in package.json:
 *   - session-card-badge → PiWorktreesBadge  (predicate: hasPiWorktrees)
 */
export { hasPiWorktrees } from "./predicates.js";
export { PiWorktreesBadge } from "./PiWorktreesBadge.js";
