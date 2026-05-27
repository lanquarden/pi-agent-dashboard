import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function formatModelLabel(m: Pick<ModelInfo, "id" | "provider" | "name" | "providerName">): string {
  const modelName = m.name && m.name.trim().length > 0 ? m.name : m.id;
  const provName = m.providerName && m.providerName.trim().length > 0 ? m.providerName : m.provider;
  return `${modelName} (${provName})`;
}

export function resolveModelLabel(current?: string, models?: ModelInfo[]): string | undefined {
  if (!current) return current;
  if (!models || models.length === 0) return current;
  // current is usually provider/id
  const slashIdx = current.indexOf("/");
  const provider = slashIdx > 0 ? current.slice(0, slashIdx) : undefined;
  const id = slashIdx > 0 ? current.slice(slashIdx + 1) : current;
  const match = models.find((m) => (provider ? m.provider === provider : true) && m.id === id);
  if (!match) return current;
  return formatModelLabel(match);
}
