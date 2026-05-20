/**
 * Client entry barrel for the pi-dev-worktrees-plugin.
 *
 * Component slots claimed by `pi-dashboard-plugin` in package.json:
 *   - session-card-badge → PiDevWorktreesBadge  (predicate: hasPiDevWorktrees)
 */
import { registerInteractiveRenderer } from "@blackbelt-technology/dashboard-plugin-runtime";
import { BashDispatchRenderer } from "./BashDispatchRenderer.js";

registerInteractiveRenderer("bash-dispatch", BashDispatchRenderer);

export { hasPiDevWorktrees } from "./predicates.js";
export { PiDevWorktreesBadge } from "./PiDevWorktreesBadge.js";
