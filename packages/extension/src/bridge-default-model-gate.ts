/**
 * Pure gate predicate for the bridge's default-model application.
 *
 * Decides whether the bridge should call `pi.setModel()` with `config.defaultModel`
 * at `session_start` time.
 *
 * Rule: apply default only on brand-new sessions (no prior entries on disk).
 * Resumed (`--session`), forked (`--fork`, parent entries copied by
 * `SessionManager.forkFrom`), and reloaded sessions all have entries > 0 and
 * SHALL keep their existing model. Mirrors pi's own `!hasExistingSession`
 * gate in `buildSessionOptions` (`pi-coding-agent/dist/main.js`).
 *
 * See change: fix-resume-keeps-session-model.
 */
export interface DefaultModelGateInput {
  /** `event.reason` from the pi `session_start` event. */
  reason: string | undefined;
  /** `ctx.sessionManager.getEntries().length` at session_start. */
  entryCount: number;
  /** Whether the bridge has captured a model registry from pi yet. */
  hasModelRegistry: boolean;
  /** Whether `config.defaultModel` is set to a non-empty string. */
  hasDefaultModel: boolean;
}

export function shouldApplyDefaultModel(args: DefaultModelGateInput): boolean {
  if (args.reason !== "startup") return false;
  if (args.entryCount !== 0) return false;
  if (!args.hasModelRegistry) return false;
  if (!args.hasDefaultModel) return false;
  return true;
}
