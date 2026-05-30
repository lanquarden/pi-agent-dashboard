import React from "react";
import type { ToolRendererProps } from "./types.js";
import { GenericToolRenderer } from "./GenericToolRenderer.js";

/**
 * Renderer for get_subagent_result tool results.
 * Displays subagent output with agent metadata.
 * TODO: full implementation — currently delegating to GenericToolRenderer.
 */
export function GetSubagentResultRenderer(props: ToolRendererProps) {
  return <GenericToolRenderer {...props} />;
}
