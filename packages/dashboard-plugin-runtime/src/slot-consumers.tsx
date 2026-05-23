/**
 * One slot consumer component per slot id.
 *
 * Each consumer:
 * 1. Reads the slot registry via PluginContextProvider.
 * 2. Filters claims for its slot id (and any additional prop-based filter).
 * 3. Renders each contribution wrapped in a per-claim SlotErrorBoundary
 *    and a CurrentPluginLayer (so plugin hooks work correctly).
 * 4. Renders nothing when zero claims match.
 */
import React from "react";
import { useSlotRegistryOrNull, CurrentPluginLayer } from "./plugin-context.js";
import { forSession, forSessionRendered, forFolder, forTab, forToolName } from "./slot-registry.js";
import { SlotErrorBoundary } from "./slot-error-boundary.js";
import { IntentRenderer } from "./intent-renderer.js";
import { useSlotIntents } from "./intent-store.js";
import { sendPluginAction } from "./plugin-action-bridge.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SlotId } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";
import type { FolderDescriptor } from "./slot-registry.js";

/**
 * Returns true when at least one plugin claim exists for `slotId` AND matches
 * the given `session` per the slot's session targeting rules AND would
 * actually render visible output (i.e. its `shouldRender(session)` returns
 * `true`, or no `shouldRender` is declared). Lets call sites conditionally
 * render parent containers (e.g. titled subcards) without triggering the
 * slot's own render path twice.
 *
 * Note: this consults `shouldRender` (introduced by change
 * `auto-hide-empty-session-subcards`). Claims whose component conditionally
 * returns `null` should declare `shouldRender` so this hook reports `false`
 * and parent wrappers hide cleanly.
 */
export function useSlotHasClaimsForSession(slotId: SlotId, session: DashboardSession): boolean {
  const registry = useSlotRegistryOrNull();
  if (!registry) return false;
  return forSessionRendered(registry.getClaims(slotId), session).length > 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderClaim(
  claim: { pluginId: string; Component?: React.ComponentType<Record<string, unknown>> },
  slotId: string,
  props: Record<string, unknown>,
) {
  if (!claim.Component) return null;
  const Comp = claim.Component;
  return (
    <SlotErrorBoundary key={`${claim.pluginId}:${slotId}`} pluginId={claim.pluginId} slotId={slotId}>
      <CurrentPluginLayer pluginId={claim.pluginId}>
        <Comp {...props} />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  );
}

/**
 * Render an entry from the IntentStore. Wraps in a SlotErrorBoundary +
 * CurrentPluginLayer so plugin-hook semantics match legacy refs claims.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
function renderIntent(
  pluginId: string,
  slotId: SlotId,
  intent: IntentNode,
  sessionId: string | null,
) {
  return (
    <SlotErrorBoundary key={`intent:${pluginId}:${slotId}`} pluginId={pluginId} slotId={slotId}>
      <CurrentPluginLayer pluginId={pluginId}>
        <IntentRenderer
          intent={intent}
          pluginId={pluginId}
          send={(action, payload) => sendPluginAction(pluginId, sessionId, action, payload)}
        />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  );
}

// ── Slot consumers ────────────────────────────────────────────────────────────

export function SidebarFolderSectionSlot({ folder }: { folder: FolderDescriptor }) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forFolder(registry.getClaims("sidebar-folder-section"), folder);
  if (!claims.length) return null;
  return (
    <>
      {claims.map(c =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "sidebar-folder-section", { folder }),
      )}
    </>
  );
}

export function SessionCardBadgeSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-badge", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-badge"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-badge", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-badge", intent, session.id),
      )}
    </>
  );
}

export function SessionCardActionBarSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-action-bar", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-action-bar"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-action-bar", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-action-bar", intent, session.id),
      )}
    </>
  );
}

export function SessionCardMemorySlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-memory", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-memory"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-memory", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-memory", intent, session.id),
      )}
    </>
  );
}

export function SessionCardFlowsSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-flows", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-flows"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-flows", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-flows", intent, session.id),
      )}
    </>
  );
}

export function WorkspaceActionBarSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("workspace-action-bar", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("workspace-action-bar"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "workspace-action-bar", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "workspace-action-bar", intent, session.id),
      )}
    </>
  );
}

export function ContentViewSlot({
  session,
  routeParams,
  onClose,
}: {
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  // Multiple plugins may claim `content-view` (multiplicity:
  // "one-active"). Each claim's optional `predicate` decides whether
  // it wants to render right now; predicates close over the plugin's
  // own UI-state store. The first claim (priority order) whose
  // predicate returns true wins. If no predicate is true, this slot
  // renders null so the shell's `?? sessionDetail` fallback shows the
  // default chat view. See change: pluginize-flows-via-registry
  // (design.md Decision 3 RECONSIDERED).
  const intents = useSlotIntents("content-view", session.id);
  const legacyClaims = registry
    ? forSession(registry.getClaims("content-view"), session)
    : [];
  // one-active: intents take precedence over legacy when both present.
  if (intents.size > 0) {
    const [pluginId, intent] = Array.from(intents.entries())[0];
    return renderIntent(pluginId, "content-view", intent, session.id) as React.ReactElement;
  }
  if (!legacyClaims.length) return null;
  const claim = legacyClaims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "content-view", {
    session,
    routeParams,
    onClose,
  });
}

export function ContentHeaderStickySlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("content-header-sticky", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("content-header-sticky"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "content-header-sticky", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "content-header-sticky", intent, session.id),
      )}
    </>
  );
}

export function ContentInlineFooterSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("content-inline-footer", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("content-inline-footer"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "content-inline-footer", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "content-inline-footer", intent, session.id),
      )}
    </>
  );
}

export function AnchoredPopoverSlot({
  anchorEl,
  onDismiss,
}: {
  anchorEl: HTMLElement;
  onDismiss: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = registry.getClaims("anchored-popover");
  if (!claims.length) return null;
  // one-at-a-time: render the first claim only
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "anchored-popover", {
    anchorEl,
    onDismiss,
  });
}

export function CommandRouteSlot({
  command,
  session,
  routeParams,
  onClose,
}: {
  command: string;
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const allClaims = registry.getClaims("command-route");
  const claims = allClaims.filter(c => c.command === command);
  if (!claims.length) return null;
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "command-route", {
    session,
    routeParams,
    onClose,
  });
}

export function SettingsSectionSlot({ tab = "general" }: { tab?: string }) {
  const registry = useSlotRegistryOrNull();
  // settings-section is global (sessionId=null). Per-tab filtering on
  // intents is the plugin's responsibility (it can choose not to emit
  // for a non-matching tab); for legacy refs claims we still use forTab.
  const intents = useSlotIntents("settings-section", null);
  const legacyClaims = registry
    ? forTab(registry.getClaims("settings-section"), tab)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "settings-section", {}),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "settings-section", intent, null),
      )}
    </>
  );
}

/**
 * Render every `settings-section` claim that belongs to a single plugin id,
 * irrespective of the claim's `tab` field. Used by the Plugins activation tab
 * to render a plugin's settings inline beneath its activation row.
 *
 * Sorted by registry order (descending priority, ties broken by registration
 * order — the registry already pre-sorts).
 *
 * See change: add-plugin-activation-ui.
 */
export function SettingsSectionByPluginSlot({ pluginId }: { pluginId: string }) {
  const registry = useSlotRegistryOrNull();
  // Note: we deliberately do NOT use the intent store here. Activation-tab
  // rendering only consumes the claim form. If a plugin author later adds
  // intent-driven settings sections, they will still surface through the
  // legacy <SettingsSectionSlot tab="..."> consumers in SettingsPanel.
  const claims = registry
    ? registry.getClaims("settings-section").filter((c) => c.pluginId === pluginId)
    : [];
  if (!claims.length) return null;
  return (
    <>
      {claims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "settings-section", {}),
      )}
    </>
  );
}

export function CommandInputActionSlot({ session, onInsertText, setInputText }: { session: DashboardSession; onInsertText?: (text: string) => void; setInputText?: (text: string) => void }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("command-input-action", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("command-input-action"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "command-input-action", { session, onInsertText, setInputText }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "command-input-action", intent, session.id),
      )}
    </>
  );
}

export function ToolRendererSlot({
  toolName,
  toolInput,
  sessionId,
  FallbackComponent,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  FallbackComponent?: React.ComponentType<{
    toolName: string;
    toolInput: Record<string, unknown>;
    sessionId: string;
  }>;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forToolName(registry.getClaims("tool-renderer"), toolName);
  if (!claims.length) {
    return FallbackComponent ? (
      <FallbackComponent toolName={toolName} toolInput={toolInput} sessionId={sessionId} />
    ) : null;
  }
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "tool-renderer", {
    toolName,
    toolInput,
    sessionId,
  });
}
