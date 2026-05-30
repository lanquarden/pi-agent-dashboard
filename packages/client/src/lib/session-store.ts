/**
 * Client-side session store bridge.
 *
 * Holds a snapshot of all DashboardSession objects so that the plugin API
 * (`getSession`, `getAllSessions`, `subscribeSession`) can read sessions
 * outside the React tree. Updated by App.tsx whenever session state changes.
 *
 * See change: runtime-plugin-loading (DashboardPluginApi).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

let sessions: DashboardSession[] = [];
const subscribers = new Set<(sessions: DashboardSession[]) => void>();

/** Replace the entire session snapshot (called from React on state change). */
export function setSessionSnapshot(newSessions: DashboardSession[]): void {
  sessions = newSessions;
  for (const fn of subscribers) fn(newSessions);
}

/** Read all sessions synchronously. */
export function getAllSessions(): DashboardSession[] {
  return sessions;
}

/** Read a single session by id. */
export function getSession(id: string): DashboardSession | undefined {
  return sessions.find((s) => s.id === id);
}

/** Subscribe to session changes. Returns unsubscribe function. */
export function subscribeSessions(
  fn: (sessions: DashboardSession[]) => void,
): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Wipe state for tests. */
export function __resetSessionStoreForTests(): void {
  sessions = [];
  subscribers.clear();
}
