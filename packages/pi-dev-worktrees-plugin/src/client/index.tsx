/**
 * Client entry barrel for the pi-dev-worktrees-plugin.
 *
 * Component slots claimed by `pi-dashboard-plugin` in package.json:
 *   - session-card-badge → PiDevWorktreesBadge  (predicate: hasPiDevWorktrees)
 */
export { hasPiDevWorktrees } from "./predicates.js";
export { PiDevWorktreesBadge } from "./PiDevWorktreesBadge.js";
