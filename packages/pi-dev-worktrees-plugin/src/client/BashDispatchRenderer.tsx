import React from "react";
import type { InteractiveRendererProps } from "@blackbelt-technology/dashboard-plugin-runtime";

interface BashDispatchProps {
  llmCommand?: string;
  rtkRewritten?: boolean;
  rtkCommand?: string;
  routing?: "host" | "container" | "error";
  errorMessage?: string;
  hasDevcontainer?: boolean;
}

export function BashDispatchRenderer({ params, status }: InteractiveRendererProps) {
  if (status !== "pending") return null;

  const componentProps = (params._promptBusComponent as { props?: BashDispatchProps } | undefined)?.props ?? {};
  const {
    llmCommand,
    rtkRewritten,
    rtkCommand,
    routing,
    errorMessage,
    hasDevcontainer,
  } = componentProps;

  if (!llmCommand && !routing) return null;

  const command = llmCommand ?? (params.title as string | undefined) ?? "";

  return (
    <div className="mx-4 my-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-sm font-mono flex items-center gap-2">
      <span className="text-[var(--text-secondary)]">$</span>
      <span className="flex-1 truncate text-[var(--text-primary)]">{command}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        {rtkRewritten && (
          <span
            className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-amber-400/15 text-amber-400"
            title={rtkCommand}
          >
            RTK
          </span>
        )}
        {routing === "container" && (
          <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-blue-400/15 text-blue-400">
            container
          </span>
        )}
        {routing === "host" && hasDevcontainer && (
          <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-[var(--bg-quaternary)] text-[var(--text-secondary)]">
            host
          </span>
        )}
        {routing === "error" && (
          <span
            className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-red-400/15 text-red-400"
            title={errorMessage}
          >
            error
          </span>
        )}
      </span>
    </div>
  );
}
