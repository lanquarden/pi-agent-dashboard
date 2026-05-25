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

/** Function returning a plain-text summary string for the collapsed tool header row */
export type SummaryFn = (args?: Record<string, unknown>) => string;
const summaryRegistry = new Map<string, SummaryFn>();

/** Register a custom renderer for a tool name, with optional header chips and/or summary override */
export function registerToolRenderer(
  toolName: string,
  renderer: ToolRenderer,
  opts?: { headerChips?: HeaderChipsFn; summary?: SummaryFn },
): void {
  renderers.set(toolName, renderer);
  if (opts?.headerChips) {
    headerChipsRegistry.set(toolName, opts.headerChips);
  }
  if (opts?.summary) {
    summaryRegistry.set(toolName, opts.summary);
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

/** Get the summary override function for a tool (if registered by a plugin) */
export function getToolSummary(toolName: string): SummaryFn | undefined {
  return summaryRegistry.get(toolName);
}
