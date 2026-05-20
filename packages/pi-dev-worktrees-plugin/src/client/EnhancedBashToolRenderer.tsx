import React from "react";
import type { ToolRendererProps } from "@blackbelt-technology/dashboard-plugin-runtime";
import { BashToolRenderer } from "../../../../packages/client/src/components/tool-renderers/BashToolRenderer.js";

interface BashDispatchData {
  llmCommand?: string;
  rtkRewritten?: boolean;
  rtkCommand?: string;
  routing?: "host" | "container" | "error";
  hasDevcontainer?: boolean;
}

function DispatchChips({ dispatch }: { dispatch: BashDispatchData }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {dispatch.rtkRewritten && (
        <span
          className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-amber-400/15 text-amber-400"
          title={dispatch.rtkCommand}
        >
          RTK
        </span>
      )}
      {dispatch.routing === "container" && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-blue-400/15 text-blue-400">
          container
        </span>
      )}
      {dispatch.routing === "host" && dispatch.hasDevcontainer && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-[var(--bg-quaternary)] text-[var(--text-secondary)]">
          host
        </span>
      )}
      {dispatch.routing === "error" && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-red-400/15 text-red-400">
          error
        </span>
      )}
    </span>
  );
}

export function EnhancedBashToolRenderer(props: ToolRendererProps) {
  const dispatch = (props.args as any)?._pluginData?.["pi-dev-worktrees:bash-dispatch"] as BashDispatchData | undefined;

  if (!dispatch) {
    return <BashToolRenderer {...props} />;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--accent-green)] font-mono">$</span>
        <span className="text-xs text-[var(--text-secondary)] font-mono truncate flex-1">
          {(props.args?.command as string) ?? "command"}
        </span>
        <DispatchChips dispatch={dispatch} />
      </div>

      {props.status === "running" && !props.result && (
        <div className="text-xs text-[var(--text-muted)] italic">Running…</div>
      )}

      {props.result && (
        <div className="max-h-80 overflow-auto rounded bg-[var(--bg-code)] p-2">
          <pre className="whitespace-pre-wrap text-xs font-mono text-[var(--text-secondary)]">
            {props.result}
          </pre>
        </div>
      )}
    </div>
  );
}
