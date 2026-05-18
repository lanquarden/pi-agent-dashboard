/**
 * Voice Input Plugin — client entry
 *
 * Provides:
 * - MicButton: push-to-talk / toggle mic button for the command-input-action slot
 * - VoiceInputSettings: plugin config UI in Settings > General
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Icon } from "@mdi/react";
import { mdiMicrophone, mdiMicrophoneOff } from "@mdi/js";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props";

// ── Config type ──────────────────────────────────────────────────────────────

export interface VoiceInputConfig {
  mode: "push-to-talk" | "toggle";
  transcriptionEngine: "client" | "server";
  language: string;
  serverEngine: "parakeet-onnx" | "openai-whisper";
  openaiApiKey: string;
  parakeetModelRepo: string;
  vadThreshold: number;
  parakeetModelUrl: string;
}

const DEFAULT_CONFIG: VoiceInputConfig = {
  mode: "push-to-talk",
  transcriptionEngine: "client",
  language: "en",
  serverEngine: "parakeet-onnx",
  openaiApiKey: "",
  parakeetModelRepo: "ysdede/parakeet-tdt-0.6b-v3-onnx",
  vadThreshold: 0.3,
  parakeetModelUrl: "",
};

// ── Audio capture helpers ────────────────────────────────────────────────────

type AudioChunkCallback = (chunk: Float32Array) => void;

function createAudioCapture(onChunk: AudioChunkCallback, sampleRate = 16000): { start: () => Promise<void>; stop: () => void } {
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: { ideal: sampleRate }, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    audioContext = new AudioContext({ sampleRate });
    source = audioContext.createMediaStreamSource(stream);
    // ScriptProcessorNode buffer size: ~100ms at 16kHz
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      onChunk(new Float32Array(input));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  function stop() {
    processor?.disconnect();
    source?.disconnect();
    audioContext?.close();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioContext = null;
    processor = null;
    source = null;
  }

  return { start, stop };
}

// ── Status enum ──────────────────────────────────────────────────────────────

type MicStatus = "idle" | "requesting-permission" | "loading-model" | "listening" | "transcribing" | "error";

// ── MicButton ────────────────────────────────────────────────────────────────

/**
 * MicButton — rendered in the command-input-action slot.
 *
 * Push-to-talk: hold the button to record, release to transcribe and insert text.
 * Toggle: click to start/stop recording.
 *
 * Props come from the slot system:
 * - session: current DashboardSession
 * - onInsertText: callback to insert transcribed text into the CommandInput textarea
 */
export function MicButton({ session, onInsertText }: SlotProps<"command-input-action">) {
  const config = usePluginConfig<VoiceInputConfig>() ?? DEFAULT_CONFIG;
  const send = usePluginSend();
  const [status, setStatus] = useState<MicStatus>("idle");
  const [liveText, setLiveText] = useState("");

  const captureRef = useRef<ReturnType<typeof createAudioCapture> | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setStatus("requesting-permission");

      // TODO: In client mode, load parakeet.js and ONNX model here.
      // For MVP, set a brief loading state then begin capture.
      setStatus("loading-model");

      const capture = createAudioCapture((chunk) => {
        chunksRef.current.push(chunk);
      });
      captureRef.current = capture;
      await capture.start();
      setStatus("listening");
      setLiveText("● Listening...");
    } catch (err: unknown) {
      const e = err as Error & { name?: string };
      const msg = e.name === "NotAllowedError"
        ? "Microphone permission denied"
        : e.message || "Unknown error";
      setStatus("error");
      setLiveText(msg);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setStatus("transcribing");
    setLiveText("Transcribing...");

    // TODO: Run transcription on accumulated audio chunks.
    // For MVP, this is a placeholder.
    const allChunks = chunksRef.current;
    chunksRef.current = [];

    if (config.transcriptionEngine === "client") {
      // Client-side: run parakeet.js inference
      // Placeholder — would run ONNX inference on the audio data
      await new Promise((r) => setTimeout(r, 500));
      const transcribedText = "[Voice transcription placeholder]";
      onInsertText?.(transcribedText);
    } else {
      // Server-side: send audio chunks to dashboard server via plugin WS
      // Placeholder — would stream PCM chunks to server
      await new Promise((r) => setTimeout(r, 500));
      const transcribedText = "[Server transcription placeholder]";
      onInsertText?.(transcribedText);
    }

    setStatus("idle");
    setLiveText("");
  }, [config.transcriptionEngine, onInsertText]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (config.mode === "push-to-talk") {
      isHoldingRef.current = true;
      holdTimerRef.current = setTimeout(() => {
        if (isHoldingRef.current) startRecording();
      }, 200); // 200ms hold threshold to distinguish tap from accidental touch
    }
  }, [config.mode, startRecording]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;

    if (config.mode === "push-to-talk") {
      if (status === "listening") {
        stopRecording();
      }
    }
  }, [config.mode, status, stopRecording]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (config.mode === "toggle") {
      if (status === "listening") {
        stopRecording();
      } else if (status === "idle" || status === "error") {
        startRecording();
      }
    }
  }, [config.mode, status, startRecording, stopRecording]);

  const handlePointerLeave = useCallback(() => {
    // If holding and pointer leaves the button while recording, keep recording
    // (user might be adjusting grip). Stop only on pointerUp.
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;
  }, []);

  const isActive = status === "listening" || status === "loading-model";
  const isProcessing = status === "transcribing" || status === "requesting-permission" || status === "loading-model";

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        aria-label={isActive ? "Stop recording" : "Start voice input"}
        title={config.mode === "push-to-talk" ? "Hold to record" : "Click to toggle recording"}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        disabled={isProcessing}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "32px",
          height: "32px",
          padding: 0,
          border: "none",
          borderRadius: "50%",
          cursor: isProcessing ? "wait" : "pointer",
          background: isActive
            ? "#ef4444"
            : status === "error"
              ? "#f59e0b"
              : "transparent",
          color: isActive ? "#fff" : status === "error" ? "#fff" : "#9ca3af",
          opacity: isProcessing ? 0.5 : 1,
          transition: "background 0.2s, color 0.2s",
          marginRight: "4px",
        }}
      >
        <Icon
          path={isActive ? mdiMicrophone : mdiMicrophoneOff}
          size={0.8}
        />
        {isActive && (
          <span
            style={{
              position: "absolute",
              inset: "-2px",
              borderRadius: "50%",
              border: "2px solid #ef4444",
              animation: "voice-input-pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </button>
      {liveText && (
        <span
          style={{
            fontSize: "11px",
            color: isActive ? "#ef4444" : "#9ca3af",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "200px",
            marginLeft: "4px",
          }}
        >
          {liveText}
        </span>
      )}
      <style>{`
        @keyframes voice-input-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}

// ── VoiceInputSettings ───────────────────────────────────────────────────────

const ENGINE_OPTIONS = [
  { value: "client", label: "Client (parakeet.js — WebGPU/WASM, ~600MB model)" },
  { value: "server", label: "Server (dashboard server — recommended for mobile)" },
];

const SERVER_ENGINE_OPTIONS = [
  { value: "parakeet-onnx", label: "Parakeet ONNX (local, same model as client — via onnxruntime-node)" },
  { value: "openai-whisper", label: "OpenAI Whisper API (cloud, requires API key)" },
];

const MODE_OPTIONS = [
  { value: "push-to-talk", label: "Push to talk (hold button to record)" },
  { value: "toggle", label: "Toggle (click to start/stop)" },
];

export function VoiceInputSettings() {
  const rawConfig = usePluginConfig<VoiceInputConfig>();
  // Merge with defaults so partial configs (e.g. from seeded tests) don't crash
  const config: VoiceInputConfig = { ...DEFAULT_CONFIG, ...rawConfig };
  const send = usePluginSend();

  // Sync state from config, but only when the underlying rawConfig changes (stable ref).
  // Spread creates a new object every render, so we depend on rawConfig, not config.
  const [local, setLocal] = useState<VoiceInputConfig>(() => ({ ...config }));

  useEffect(() => {
    setLocal({ ...config });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawConfig]);

  const update = useCallback((patch: Partial<VoiceInputConfig>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
  }, []);

  const save = useCallback(() => {
    send({
      type: "plugin_config_write" as never,
      id: "voice-input",
      config: local,
    });
  }, [send, local]);

  return (
    <div data-testid="voice-input-settings" style={{ fontSize: "12px", color: "#d1d5db" }}>
      <h3 style={{ fontSize: "13px", margin: "0 0 8px 0", color: "#f3f4f6" }}>Voice Input</h3>

      {/* Mode */}
      <label style={{ display: "block", marginBottom: "8px" }}>
        <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>Recording mode</span>
        <select
          value={local.mode}
          onChange={(e) => update({ mode: e.target.value as VoiceInputConfig["mode"] })}
          style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Transcription engine */}
      <label style={{ display: "block", marginBottom: "8px" }}>
        <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>Transcription engine</span>
        <select
          value={local.transcriptionEngine}
          onChange={(e) => update({ transcriptionEngine: e.target.value as VoiceInputConfig["transcriptionEngine"] })}
          style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
        >
          {ENGINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Language */}
      <label style={{ display: "block", marginBottom: "8px" }}>
        <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>Language</span>
        <input
          type="text"
          value={local.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder="en"
          style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
        />
      </label>

      {/* Server engine (conditional) */}
      {local.transcriptionEngine === "server" && (
        <>
          <label style={{ display: "block", marginBottom: "8px" }}>
            <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>Server STT engine</span>
            <select
              value={local.serverEngine}
              onChange={(e) => update({ serverEngine: e.target.value as VoiceInputConfig["serverEngine"] })}
              style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
            >
              {SERVER_ENGINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {local.serverEngine === "openai-whisper" && (
            <label style={{ display: "block", marginBottom: "8px" }}>
              <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>OpenAI API key</span>
              <input
                type="password"
                value={local.openaiApiKey}
                onChange={(e) => update({ openaiApiKey: e.target.value })}
                placeholder="sk-..."
                style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
              />
            </label>
          )}

          {local.serverEngine === "parakeet-onnx" && (
            <label style={{ display: "block", marginBottom: "8px" }}>
              <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>HuggingFace model repo</span>
              <input
                type="text"
                value={local.parakeetModelRepo}
                onChange={(e) => update({ parakeetModelRepo: e.target.value })}
                placeholder="ysdede/parakeet-tdt-0.6b-v3-onnx"
                style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
              />
            </label>
          )}
        </>
      )}

      {/* VAD threshold */}
      <label style={{ display: "block", marginBottom: "8px" }}>
        <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>
          VAD threshold: {local.vadThreshold.toFixed(1)}
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={local.vadThreshold}
          onChange={(e) => update({ vadThreshold: parseFloat(e.target.value) })}
          style={{ width: "100%" }}
        />
      </label>

      {/* Parakeet model URL (client mode only) */}
      {local.transcriptionEngine === "client" && (
        <label style={{ display: "block", marginBottom: "8px" }}>
          <span style={{ display: "block", marginBottom: "2px", fontWeight: 500 }}>Parakeet model URL</span>
          <input
            type="text"
            value={local.parakeetModelUrl}
            onChange={(e) => update({ parakeetModelUrl: e.target.value })}
            placeholder="Default CDN (Hugging Face)"
            style={{ width: "100%", padding: "4px 6px", fontSize: "12px", background: "#1f2937", color: "#d1d5db", border: "1px solid #374151", borderRadius: "4px" }}
          />
        </label>
      )}

      <button
        data-testid="voice-input-save"
        onClick={save}
        style={{
          padding: "4px 12px",
          fontSize: "12px",
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          marginTop: "4px",
        }}
      >
        Save
      </button>
    </div>
  );
}
