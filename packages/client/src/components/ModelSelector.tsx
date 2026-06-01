import React, { useState, useRef, useEffect, useCallback } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronDown, mdiLoading } from "@mdi/js";
import type { ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { resolveModelLabel } from "../lib/model-label.js";

interface Props {
  current?: string;
  models?: ModelInfo[];
  onSelect: (model: string) => void;

  /**
   * @deprecated Roles UI moved to a `settings-section` plugin contribution
   * (BuiltInRolesSettings in @blackbelt-technology/pi-dashboard-roles-plugin).
   * The prop is kept for backward compatibility with callers that still drill
   * `RoleInfo` through, but it has no effect on rendering. See change:
   * fix-pi-flows-end-to-end (Group 5).
   */
  roles?: RoleInfo;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onRoleSet?: (role: string, modelId: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetLoad?: (presetName: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetSave?: (presetName: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetDelete?: (presetName: string) => void;
}

export function ModelSelector({ current, models, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hasModels = models && models.length > 0;

  // Clear pending state when current model updates to match
  useEffect(() => {
    if (pendingModel && current === pendingModel) setPendingModel(null);
  }, [current, pendingModel]);

  // Safety timeout: clear pending after 10s if no update arrives
  useEffect(() => {
    if (!pendingModel) return;
    const timer = setTimeout(() => setPendingModel(null), 10_000);
    return () => clearTimeout(timer);
  }, [pendingModel]);

  const uniqueProviders = hasModels
    ? [...new Set(models.map((m) => m.provider))].sort()
    : [];

  const filtered = hasModels
    ? models.filter((m) => {
        if (providerFilter && m.provider !== providerFilter) return false;
        const full = `${m.provider}/${m.id}`.toLowerCase();
        const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return tokens.length === 0 || tokens.every((token) => full.includes(token));
      })
    : [];

  // Reset filter and index when opening
  useEffect(() => {
    if (open) {
      setFilter("");
      setProviderFilter("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-model-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (m: ModelInfo) => {
      const label = `${m.provider}/${m.id}`;
      setPendingModel(label);
      onSelect(label);
      setOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) handleSelect(filtered[selectedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative" data-testid="model-selector">
      <button
        onClick={() => hasModels && setOpen(!open)}
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
          hasModels
            ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            : "text-[var(--text-muted)]"
        }`}
        disabled={!hasModels}
        data-testid="model-selector-button"
      >
        <span className="font-mono truncate max-w-[200px]">
          {pendingModel ? (
            <>
              {pendingModel} <Icon path={mdiLoading} size={0.4} className="inline animate-spin" />
            </>
          ) : (
            current ? (resolveModelLabel(current, models) ?? current) : "no model"
          )}
        </span>
        {hasModels && !pendingModel && <Icon path={mdiChevronDown} size={0.5} />}
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-50 overflow-hidden"
          style={{ width: "18rem" }}
          data-testid="model-dropdown"
        >
          {/* ── Filter input ── */}
          <div className="p-1.5 pb-1 space-y-1">
            {uniqueProviders.length > 1 && (
              <select
                value={providerFilter}
                onChange={(e) => {
                  setProviderFilter(e.target.value);
                  setSelectedIndex(0);
                }}
                className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                data-testid="provider-filter"
              >
                <option value="">All Providers</option>
                {uniqueProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
            <input
              ref={inputRef}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Filter models…"
              className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
              data-testid="model-filter"
            />
          </div>

          {/* ── Model list ── */}
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No models match</div>
            ) : (
              filtered.map((m, i) => {
                const label = `${m.provider}/${m.id}`;
                const isCurrent = label === current;
                return (
                  <button
                    key={label}
                    data-model-item
                    onClick={() => handleSelect(m)}
                    className={`w-full px-3 py-1 min-h-[44px] md:min-h-0 md:py-1 text-left text-xs flex items-center gap-2 ${
                      i === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
                    } ${isCurrent ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
                  >
                    <span className="truncate">{(m as any).name || (m as any).providerName ? `${(m as any).name ?? m.id} (${(m as any).providerName ?? m.provider})` : label}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono">{label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
