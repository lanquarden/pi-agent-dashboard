import React from "react";
import type { ToolRendererProps } from "./types.js";
import { GenericToolRenderer } from "./GenericToolRenderer.js";

/**
 * Renderer for steer_subagent tool results.
 * Displays steering message and subagent response.
 * TODO: full implementation — currently delegating to GenericToolRenderer.
 */
export function SteerSubagentRenderer(props: ToolRendererProps) {
  return <GenericToolRenderer {...props} />;
}
