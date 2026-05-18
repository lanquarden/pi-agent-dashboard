/**
 * VoiceInputSettings component tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

function makeSend(): { messages: unknown[]; fn: (m: unknown) => void } {
  const messages: unknown[] = [];
  return { messages, fn: (m: unknown) => messages.push(m) };
}

function wrap(children: React.ReactNode, send?: (m: unknown) => void) {
  return (
    <PluginContextProvider registry={createSlotRegistry()} sessions={[makeSession()]} send={send}>
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
  beforeEach(() => {
    seedConfig({ mode: "push-to-talk", transcriptionEngine: "client", language: "en" });
  });
  afterEach(() => { cleanup(); seedConfig({}); });

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

  it("switches between push-to-talk and toggle", () => {
    const send = makeSend();
    render(wrap(<VoiceInputSettings />, send.fn));

    const modeSelect = getSelectByLabel("Recording mode");
    fireEvent.change(modeSelect, { target: { value: "toggle" } });
    expect(modeSelect.value).toBe("toggle");

    fireEvent.click(screen.getByTestId("voice-input-save"));
    expect(send.messages[0]).toMatchObject({ type: "plugin_config_write", id: "voice-input" });
    expect((send.messages[0] as { config: VoiceInputConfig }).config.mode).toBe("toggle");
  });

  it("switches between client and server engine", () => {
    const send = makeSend();
    render(wrap(<VoiceInputSettings />, send.fn));

    const engineSelect = getSelectByLabel("Transcription engine");
    fireEvent.change(engineSelect, { target: { value: "server" } });
    expect(engineSelect.value).toBe("server");

    // Server engine options should now be visible
    const serverSelect = getSelectByLabel("Server STT engine");
    expect(serverSelect.value).toBe("parakeet-onnx");

    fireEvent.click(screen.getByTestId("voice-input-save"));
    expect((send.messages[0] as { config: VoiceInputConfig }).config.transcriptionEngine).toBe("server");
  });

  it("dispatches plugin_config_write on save", () => {
    const send = makeSend();
    render(wrap(<VoiceInputSettings />, send.fn));
    fireEvent.click(screen.getByTestId("voice-input-save"));
    expect(send.messages).toHaveLength(1);
    expect(send.messages[0]).toMatchObject({
      type: "plugin_config_write",
      id: "voice-input",
      config: expect.objectContaining({ mode: "push-to-talk", transcriptionEngine: "client", language: "en" }),
    });
  });

  it("updates language and saves", () => {
    const send = makeSend();
    render(wrap(<VoiceInputSettings />, send.fn));

    const langInput = screen.getByPlaceholderText("en") as HTMLInputElement;
    fireEvent.change(langInput, { target: { value: "de" } });

    fireEvent.click(screen.getByTestId("voice-input-save"));
    expect((send.messages[0] as { config: VoiceInputConfig }).config.language).toBe("de");
  });
});
