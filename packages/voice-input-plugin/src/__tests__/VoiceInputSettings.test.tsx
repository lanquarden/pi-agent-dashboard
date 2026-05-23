/**
 * VoiceInputSettings component tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, cleanup, screen } from "@testing-library/react";
import React from "react";
import {
  PluginContextProvider,
  CurrentPluginLayer,
  applyPluginConfigUpdate,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { VoiceInputSettings, type VoiceInputConfig } from "../client.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function makeSession(id = "s1"): DashboardSession {
  return { id, cwd: "/repo", source: "tui", status: "idle", startedAt: Date.now() };
}

function seedConfig(cfg: Partial<VoiceInputConfig>) {
  act(() => {
    applyPluginConfigUpdate({ type: "plugin_config_update", id: "voice-input", config: cfg });
  });
}

function wrap(children: React.ReactNode) {
  return (
    <PluginContextProvider registry={createSlotRegistry()} sessions={[makeSession()]}>
      <CurrentPluginLayer pluginId="voice-input">{children}</CurrentPluginLayer>
    </PluginContextProvider>
  );
}

// Helper: query a <select> by its label text
function getSelectByLabel(label: string): HTMLSelectElement {
  const labelEl = screen.getByText(label);
  const select = labelEl.parentElement?.querySelector("select");
  if (!select) throw new Error(`No <select> found for label "${label}"`);
  return select as HTMLSelectElement;
}

describe("VoiceInputSettings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    seedConfig({ mode: "push-to-talk", transcriptionEngine: "client", language: "en" });
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    seedConfig({});
    vi.unstubAllGlobals();
  });

  it("renders the settings form", () => {
    render(wrap(<VoiceInputSettings />));
    expect(screen.getByText("Voice Input")).toBeDefined();
    expect(screen.getByTestId("voice-input-settings")).toBeDefined();
    expect(screen.getByTestId("voice-input-save")).toBeDefined();
  });

  it("has push-to-talk selected as default mode", () => {
    render(wrap(<VoiceInputSettings />));
    const select = getSelectByLabel("Recording mode");
    expect(select.value).toBe("push-to-talk");
  });

  it("has client selected as default engine", () => {
    render(wrap(<VoiceInputSettings />));
    const select = getSelectByLabel("Transcription engine");
    expect(select.value).toBe("client");
  });

  it("switches between push-to-talk and toggle", async () => {
    render(wrap(<VoiceInputSettings />));

    const modeSelect = getSelectByLabel("Recording mode");
    fireEvent.change(modeSelect, { target: { value: "toggle" } });
    expect(modeSelect.value).toBe("toggle");

    fireEvent.click(screen.getByTestId("voice-input-save"));

    // Component saves via fetch to /api/config/plugins/voice-input
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/plugins/voice-input",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.mode).toBe("toggle");
  });

  it("switches between client and server engine", async () => {
    render(wrap(<VoiceInputSettings />));

    const engineSelect = getSelectByLabel("Transcription engine");
    fireEvent.change(engineSelect, { target: { value: "server" } });
    expect(engineSelect.value).toBe("server");

    // Server engine options should now be visible
    const serverSelect = getSelectByLabel("Server STT engine");
    expect(serverSelect.value).toBe("parakeet-onnx");

    fireEvent.click(screen.getByTestId("voice-input-save"));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.transcriptionEngine).toBe("server");
  });

  it("dispatches plugin_config_write on save", async () => {
    render(wrap(<VoiceInputSettings />));
    fireEvent.click(screen.getByTestId("voice-input-save"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/plugins/voice-input",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.mode).toBe("push-to-talk");
    expect(body.transcriptionEngine).toBe("client");
    expect(body.language).toBe("en");
  });

  it("updates language and saves", async () => {
    render(wrap(<VoiceInputSettings />));

    const langInput = screen.getByPlaceholderText("en") as HTMLInputElement;
    fireEvent.change(langInput, { target: { value: "de" } });

    fireEvent.click(screen.getByTestId("voice-input-save"));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.language).toBe("de");
  });
});
