import type { ToolRenderer, HeaderChipsFn } from "./types.js";
import { ReadToolRenderer } from "./ReadToolRenderer.js";
import { EditToolRenderer } from "./EditToolRenderer.js";
import { WriteToolRenderer } from "./WriteToolRenderer.js";
import { BashToolRenderer } from "./BashToolRenderer.js";
import { AgentToolRenderer } from "./AgentToolRenderer.js";
import { GetSubagentResultRenderer } from "./GetSubagentResultRenderer.js";
import { SteerSubagentRenderer } from "./SteerSubagentRenderer.js";
import { GenericToolRenderer } from "./GenericToolRenderer.js";
import { AskUserToolRenderer } from "./AskUserToolRenderer.js";

const renderers = new Map<string, ToolRenderer>([
  ["read", ReadToolRenderer],
  ["edit", EditToolRenderer],
  ["write", WriteToolRenderer],
  ["bash", BashToolRenderer],
  ["Agent", AgentToolRenderer],
  ["get_subagent_result", GetSubagentResultRenderer],
  ["steer_subagent", SteerSubagentRenderer],
  ["ask_user", AskUserToolRenderer],
]);

const headerChipsRegistry = new Map<string, HeaderChipsFn>();

/** Register a custom renderer for a tool name, with optional header chips */
export function registerToolRenderer(
  toolName: string,
  renderer: ToolRenderer,
  opts?: { headerChips?: HeaderChipsFn },
): void {
  renderers.set(toolName, renderer);
  if (opts?.headerChips) {
    headerChipsRegistry.set(toolName, opts.headerChips);
  }
}

/** Get the renderer for a tool, falling back to GenericToolRenderer */
export function getToolRenderer(toolName: string): ToolRenderer {
  return renderers.get(toolName) ?? GenericToolRenderer;
}

/** Get the header chips function for a tool (if registered by a plugin) */
export function getToolHeaderChips(toolName: string): HeaderChipsFn | undefined {
  return headerChipsRegistry.get(toolName);
}
