/**
 * Per-claim error boundary.
 * Wraps each slot contribution individually so one failing plugin
 * does not suppress sibling contributions in the same slot.
 *
 * Hardened for runtime-loaded (MF) plugins (Task 8):
 * - Catches errors from dynamically-loaded remote components
 * - Logs with plugin id + slot name
 * - Renders a red error pill in dev, nothing in prod
 * - Dispatches a "plugin-load-error" CustomEvent for reporting to
 *   PluginStatusStore / <PluginsSection>
 */
import React, { Component, type ReactNode } from "react";

interface Props {
  pluginId: string;
  slotId: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

const IS_DEV =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true) ||
  (typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production");

export class SlotErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[slot-error-boundary] Plugin "${this.props.pluginId}" slot "${this.props.slotId}" threw:`,
      error,
    );

    // Report to PluginStatusStore (consumed by <PluginsSection>)
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("plugin-load-error", {
          detail: {
            pluginId: this.props.pluginId,
            error: `Slot "${this.props.slotId}" threw: ${err.message}`,
          },
        }),
      );
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // In dev mode, render a red error pill so developers see failures immediately
    if (IS_DEV) {
      return React.createElement(
        "span",
        {
          style: {
            display: "inline-block",
            padding: "2px 6px",
            borderRadius: "4px",
            background: "#dc2626",
            color: "#fff",
            fontSize: "11px",
            fontFamily: "monospace",
            lineHeight: "1.4",
          },
          title: this.state.error?.message ?? "Unknown error",
        },
        `${this.props.pluginId} ⊘ ${this.props.slotId}`,
      );
    }

    // In production, render nothing (suppress the failing plugin silently)
    return null;
  }
}
