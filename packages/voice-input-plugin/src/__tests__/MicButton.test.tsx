/**
 * MicButton component tests.
 *
 * Exercises the push-to-talk / toggle mic button that renders in the
 * command-input-action slot. Tests rendering, mode switching, and
 * settings persistence without requiring actual microphone hardware.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, cleanup, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  PluginContextProvider,
  CurrentPluginLayer,
  applyPluginConfigUpdate,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { MicButton, VoiceInputSettings, type VoiceInputConfig } from "../client.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Mock the client-side transcription module so tests never hit real ONNX runtime
vi.mock("../client-transcription.js", () => ({
  loadModel: vi.fn().mockResolvedValue({}),
  getStreamer: vi.fn().mockReturnValue({
    processChunk: vi.fn().mockResolvedValue({ text: "hello world", chunkText: "hello world", words: [], is_final: false }),
    finalize: vi.fn().mockReturnValue({ text: "hello world", words: [], is_final: true }),
    reset: vi.fn(),
  }),
  transcribeChunks: vi.fn().mockResolvedValue("hello world"),
  resetStreamer: vi.fn(),
  isModelLoaded: vi.fn().mockReturnValue(true),
  isLoadingModel: vi.fn().mockReturnValue(false),
  destroyModel: vi.fn(),
}));

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeSession(id = "s1"): DashboardSession {
  return {
    id,
    cwd: "/repo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    model: "claude-sonnet-4-20250514",
  };
}

// ── Plugin context setup helpers ─────────────────────────────────────────────

function seedConfig(cfg: Partial<VoiceInputConfig>) {
  act(() => {
    applyPluginConfigUpdate({
      type: "plugin_config_update",
      id: "voice-input",
      config: cfg,
    });
  });
}

function makeSend(): { messages: unknown[]; fn: (m: unknown) => void } {
  const messages: unknown[] = [];
  return { messages, fn: (m: unknown) => messages.push(m) };
}

function wrap(children: React.ReactNode, send?: (m: unknown) => void) {
  return (
    <PluginContextProvider
      registry={createSlotRegistry()}
      sessions={[makeSession()]}
      send={send}
    >
      <CurrentPluginLayer pluginId="voice-input">
        {children}
      </CurrentPluginLayer>
    </PluginContextProvider>
  );
}

// ── Mock getUserMedia ────────────────────────────────────────────────────────

function mockGetUserMedia() {
  const mockStream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;

  // Must be a proper constructor (not arrow function) for `new AudioContext()`
  function MockAudioContext(this: Record<string, unknown>) {
    this.sampleRate = 16000;
    this.state = "running";
    this.resume = vi.fn().mockResolvedValue(undefined);
    this.destination = {};
    this.createMediaStreamSource = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));
    this.createScriptProcessor = vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null as ((e: unknown) => void) | null,
    }));
    this.createGain = vi.fn(() => ({
      gain: { value: 0 },
      connect: vi.fn(),
    }));
    this.close = vi.fn();
  }

  const originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;

  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    writable: true,
    configurable: true,
  });
  (globalThis as Record<string, unknown>).AudioContext = MockAudioContext as unknown as typeof AudioContext;

  return () => {
    if (originalGetUserMedia != null) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: originalGetUserMedia },
        writable: true,
        configurable: true,
      });
    }
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MicButton", () => {
  let restoreMocks: (() => void) | undefined;

  beforeEach(() => {
    seedConfig({ mode: "push-to-talk", transcriptionEngine: "client", language: "en" });
  });

  afterEach(() => {
    cleanup();
    seedConfig({});
    restoreMocks?.();
    restoreMocks = undefined;
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  it("renders a mic button with accessible label", () => {
    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );
    const btn = screen.getByRole("button", { name: /start voice input/i });
    expect(btn).toBeDefined();
  });

  it("shows push-to-talk title when mode is push-to-talk", () => {
    seedConfig({ mode: "push-to-talk" });
    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toContain("Hold to record");
  });

  it("shows toggle title when mode is toggle", () => {
    seedConfig({ mode: "toggle" });
    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toContain("Click to toggle");
  });

  // ── Push-to-talk behavior ────────────────────────────────────────────────

  it("enters listening state on pointerDown hold (push-to-talk)", async () => {
    restoreMocks = mockGetUserMedia();

    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");

    // pointerDown starts the 200ms hold timer
    fireEvent.pointerDown(btn);

    // After >200ms, recording should start
    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Stop recording");
      },
      { timeout: 1000 },
    );

    // Release stops recording
    fireEvent.pointerUp(btn);

    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Start voice input");
      },
      { timeout: 2000 },
    );
  });

  it("does not start recording on quick tap in push-to-talk mode", () => {
    restoreMocks = mockGetUserMedia();

    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");

    // Quick tap (<200ms): pointerDown then immediate pointerUp
    fireEvent.pointerDown(btn);
    // Simulate release before 200ms hold threshold
    fireEvent.pointerUp(btn);

    // Button should still show "start" label (not "stop")
    expect(btn.getAttribute("aria-label")).toContain("Start voice input");
  });

  // ── Toggle mode ──────────────────────────────────────────────────────────

  it("toggles recording on click in toggle mode", async () => {
    restoreMocks = mockGetUserMedia();
    seedConfig({ mode: "toggle" });

    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");

    // First click: start recording
    fireEvent.click(btn);
    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Stop recording");
      },
      { timeout: 1000 },
    );

    // Second click: stop recording
    fireEvent.click(btn);
    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Start voice input");
      },
      { timeout: 2000 },
    );
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it("shows error state when microphone permission is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(
          Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
        ),
      },
      writable: true,
      configurable: true,
    });

    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);

    await waitFor(
      () => {
        expect(screen.getByText(/Microphone permission denied/i)).toBeDefined();
      },
      { timeout: 1000 },
    );
  });

  // ── Text insertion ──────────────────────────────────────────────────────

  it("calls onInsertText after push-to-talk transcription completes", async () => {
    restoreMocks = mockGetUserMedia();
    const onInsertText = vi.fn();

    render(
      wrap(<MicButton session={makeSession()} onInsertText={onInsertText} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);

    // Wait for recording to start
    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Stop");
      },
      { timeout: 1000 },
    );

    // Release
    fireEvent.pointerUp(btn);

    // After transcription (placeholder), onInsertText should be called
    await waitFor(
      () => {
        expect(onInsertText).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });

  // ── Disabled state during processing ─────────────────────────────────────

  it("disables the button while requesting permission", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        // Never resolves — stays in "requesting permission"
        getUserMedia: vi.fn(() => new Promise(() => {})),
      },
      writable: true,
      configurable: true,
    });

    render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);

    await waitFor(
      () => {
        expect((btn as HTMLButtonElement).disabled).toBe(true);
      },
      { timeout: 1000 },
    );
  });

  // ── Cleanup on unmount ──────────────────────────────────────────────────

  it("cleans up audio capture on unmount while recording", async () => {
    restoreMocks = mockGetUserMedia();

    const { unmount } = render(
      wrap(<MicButton session={makeSession()} onInsertText={vi.fn()} pluginContext={undefined} />),
    );

    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn);

    await waitFor(
      () => {
        expect(btn.getAttribute("aria-label")).toContain("Stop");
      },
      { timeout: 1000 },
    );

    // Unmount while recording — should not throw
    expect(() => unmount()).not.toThrow();
  });
});
