/**
 * Plugin event bus — bridges WebSocket messages to plugin event listeners.
 *
 * Plugins subscribe via `onEvent(type, fn)` from DashboardPluginApi.
 * The shell's WS message handler calls `emitPluginEvent(type, msg)` for
 * every incoming message, and the bus routes it to matching subscribers.
 *
 * See change: runtime-plugin-loading (DashboardPluginApi.onEvent).
 */

type EventListener = (event: unknown) => void;
const listeners = new Map<string, Set<EventListener>>();

/**
 * Emit an event to all listeners registered for the given type.
 * Called by useMessageHandler for every server→browser message.
 */
export function emitPluginEvent(type: string, event: unknown): void {
  const subs = listeners.get(type);
  if (subs) {
    for (const fn of subs) fn(event);
  }
}

/**
 * Subscribe to events of a specific type.
 * Returns an unsubscribe function.
 */
export function onPluginEvent(
  type: string,
  fn: EventListener,
): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(fn);
  return () => {
    listeners.get(type)?.delete(fn);
  };
}

/** Wipe state for tests. */
export function __resetPluginEventBusForTests(): void {
  listeners.clear();
}
