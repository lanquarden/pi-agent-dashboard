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
import type { SlotProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import {
  loadModel,
  getStreamer,
  transcribeChunks,
  resetStreamer,
  isModelLoaded,
  isLoadingModel,
  destroyModel,
} from "./client-transcription.js";

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
  /** ONNX backend for client-side parakeet inference. "webgpu-hybrid"
   *  tries WebGPU with WASM fallback; "wasm" is slower but reliable. */
  parakeetBackend: "webgpu-hybrid" | "wasm";
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
  parakeetBackend: "wasm",
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
    console.log("[voice-input] AudioContext created:", { requestedSampleRate: sampleRate, actualSampleRate: audioContext.sampleRate, state: audioContext.state });
    // Push-to-talk mode fires startRecording() from a setTimeout callback
    // (200ms hold threshold), which runs outside the user-gesture window.
    // Browsers create the AudioContext in "suspended" state without a user
    // gesture — resume() brings it to "running" so onaudioprocess fires.
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    source = audioContext.createMediaStreamSource(stream);
    // ScriptProcessorNode buffer size: ~100ms at 16kHz
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      // Quick sanity check: are we getting non-silent audio?
      const maxSample = copy.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      console.log("[voice-input] chunk captured:", { samples: copy.length, maxAbsSample: maxSample.toFixed(4) });
      onChunk(copy);
    };
    source.connect(processor);
    // Route through a silent gain node instead of directly to destination —
    // avoids playing the microphone back through the speakers (feedback).
    // The graph must have a sink for onaudioprocess to fire.
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
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
  // Merge with defaults so the button works immediately — even before the
  // server delivers the persisted plugin config via WebSocket.
  const rawConfig = usePluginConfig<VoiceInputConfig>();
  const config: VoiceInputConfig = { ...DEFAULT_CONFIG, ...rawConfig };
  const send = usePluginSend();
  const [status, setStatus] = useState<MicStatus>("idle");
  const [liveText, setLiveText] = useState("");

  const captureRef = useRef<ReturnType<typeof createAudioCapture> | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingRef = useRef(false);
  const sessionIdRef = useRef(session.id);
  sessionIdRef.current = session.id;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, []);

  // Listen for server-side transcription results.
  // The dashboard server broadcasts `voice_input_transcript` after processing
  // audio chunks; useMessageHandler re-dispatches it as a DOM CustomEvent.
  useEffect(() => {
    function onTranscript(e: Event) {
      const detail = (e as CustomEvent).detail as {
        type: string;
        sessionId: string;
        text: string;
        partial: boolean;
        error?: string;
      };
      if (detail.sessionId !== sessionIdRef.current) return;
      if (detail.error) {
        setStatus("error");
        setLiveText(`Transcription failed: ${detail.error}`);
        setTimeout(() => { setStatus("idle"); setLiveText(""); }, 4000);
        return;
      }
      if (detail.text && !detail.partial) {
        onInsertText?.(detail.text);
        setStatus("idle");
        setLiveText("");
      }
    }
    window.addEventListener("voice-input-transcript", onTranscript);
    return () => window.removeEventListener("voice-input-transcript", onTranscript);
  }, [onInsertText]);

  const startRecording = useCallback(async () => {
    try {
      console.debug("[voice-input] startRecording:", { engine: config.transcriptionEngine, modelLoaded: isModelLoaded() });
      setStatus("requesting-permission");

      // Client mode: lazily load parakeet.js model on first use
      if (config.transcriptionEngine === "client" && !isModelLoaded() && !isLoadingModel()) {
        setStatus("loading-model");
        setLiveText("Loading speech model (~600MB)...");
        try {
          await loadModel(config, (pct) => {
            setLiveText(`Loading speech model... ${pct}%`);
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatus("error");
          setLiveText(`Model load failed: ${msg}`);
          return;
        }
      }

      resetStreamer();
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
  }, [config]);

  const stopRecording = useCallback(async () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setStatus("transcribing");
    setLiveText("Transcribing...");

    const allChunks = chunksRef.current;
    chunksRef.current = [];

    const totalSamples = allChunks.reduce((sum, c) => sum + c.length, 0);
    const durationSec = totalSamples / 16000;
    console.log("[voice-input] stopRecording:", { chunkCount: allChunks.length, totalSamples, durationSec: durationSec.toFixed(2) + "s" });

    try {
      if (config.transcriptionEngine === "client") {
        // Client-side: run parakeet.js ONNX inference on accumulated PCM chunks
        const model = await loadModel(config);
        const text = await transcribeChunks(allChunks, model);
        console.debug("[voice-input] transcription result:", { text: text || "(empty)", textLen: text.length });
        if (text) onInsertText?.(text);
        else console.warn("[voice-input] transcription produced empty text — model may not be processing audio correctly");
      } else {
        // Server-side: send audio chunks to dashboard server via plugin WebSocket.
        // The server accumulates chunks and transcribes when `final: true`.
        const base64Chunks = allChunks.map((chunk) => {
          const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          return btoa(String.fromCharCode(...bytes));
        });

        for (let i = 0; i < base64Chunks.length; i++) {
          send({
            type: "voice_input_audio",
            sessionId: session.id,
            chunk: base64Chunks[i],
            final: i === base64Chunks.length - 1,
          });
        }

        // Wait for the server's `voice_input_transcript` response (dispatched
        // as a DOM CustomEvent by useMessageHandler). The useEffect listener
        // sets status and inserts text when the transcript arrives.
        await new Promise<void>((resolve) => {
          let done = false;
          function onTranscript(e: Event) {
            if (done) return;
            const detail = (e as CustomEvent).detail as {
              sessionId: string; text: string; partial: boolean; error?: string;
            };
            if (detail.sessionId !== session.id) return;
            if (!detail.partial) {
              done = true;
              window.removeEventListener("voice-input-transcript", onTranscript);
              resolve();
            }
          }
          window.addEventListener("voice-input-transcript", onTranscript);
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("error");
      setLiveText(`Transcription failed: ${msg}`);
      return;
    }

    setStatus("idle");
    setLiveText("");
  }, [config, session, onInsertText, send]);

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

  const statusRing = isActive ? (
    <span className="absolute inset-[-2px] rounded-full border-2 border-red-500 animate-[voice-input-pulse_1.5s_ease-in-out_infinite]" />
  ) : null;

  const btnBg = isActive
    ? "bg-red-500 text-white"
    : status === "error"
      ? "bg-amber-500 text-white"
      : "text-[var(--text-muted)]";

  const btnCursor = isProcessing ? "cursor-wait opacity-50" : "cursor-pointer";

  const textColor = isActive ? "text-red-500" : "text-[var(--text-muted)]";

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={isActive ? "Stop recording" : "Start voice input"}
        title={config.mode === "push-to-talk" ? "Hold to record" : "Click to toggle recording"}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        disabled={isProcessing}
        className={`inline-flex items-center justify-center w-8 h-8 p-0 border-0 rounded-full mr-1 transition-[background,color] duration-200 ${btnBg} ${btnCursor}`}
      >
        <Icon
          path={isActive ? mdiMicrophone : mdiMicrophoneOff}
          size={0.8}
        />
        {statusRing}
      </button>
      {liveText && (
        <span
          className={`text-[11px] truncate max-w-[200px] ml-1 ${textColor}`}
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

  // Sync state from config, but only when the underlying rawConfig changes (stable ref).
  // Spread creates a new object every render, so we depend on rawConfig, not config.
  const [local, setLocal] = useState<VoiceInputConfig>(() => ({ ...config }));

  useEffect(() => {
    setLocal({ ...config });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawConfig]);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const update = useCallback((patch: Partial<VoiceInputConfig>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
  }, []);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      // Strip non-schema fields (e.g. "enabled" from plugin toggle) before sending
      const { enabled: _, ...configToSave } = local as VoiceInputConfig & { enabled?: boolean };
      const res = await fetch(`/api/config/plugins/voice-input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });
      if (!res.ok) {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      }
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }, [local]);

  return (
    <div data-testid="voice-input-settings" className="text-xs text-[var(--text-secondary)]">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Voice Input</h3>

      {/* Mode */}
      <label className="block mb-2">
        <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">Recording mode</span>
        <select
          value={local.mode}
          onChange={(e) => update({ mode: e.target.value as VoiceInputConfig["mode"] })}
          className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Transcription engine */}
      <label className="block mb-2">
        <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">Transcription engine</span>
        <select
          value={local.transcriptionEngine}
          onChange={(e) => update({ transcriptionEngine: e.target.value as VoiceInputConfig["transcriptionEngine"] })}
          className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
        >
          {ENGINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Language */}
      <label className="block mb-2">
        <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">Language</span>
        <input
          type="text"
          value={local.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder="en"
          className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
        />
      </label>

      {/* Server engine (conditional) */}
      {local.transcriptionEngine === "server" && (
        <>
          <label className="block mb-2">
            <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">Server STT engine</span>
            <select
              value={local.serverEngine}
              onChange={(e) => update({ serverEngine: e.target.value as VoiceInputConfig["serverEngine"] })}
              className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
            >
              {SERVER_ENGINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {local.serverEngine === "openai-whisper" && (
            <label className="block mb-2">
              <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">OpenAI API key</span>
              <input
                type="password"
                value={local.openaiApiKey}
                onChange={(e) => update({ openaiApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
            </label>
          )}

          {local.serverEngine === "parakeet-onnx" && (
            <label className="block mb-2">
              <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">HuggingFace model repo</span>
              <input
                type="text"
                value={local.parakeetModelRepo}
                onChange={(e) => update({ parakeetModelRepo: e.target.value })}
                placeholder="ysdede/parakeet-tdt-0.6b-v3-onnx"
                className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
            </label>
          )}
        </>
      )}

      {/* VAD threshold */}
      <label className="block mb-2">
        <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">
          VAD threshold: {local.vadThreshold.toFixed(1)}
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={local.vadThreshold}
          onChange={(e) => update({ vadThreshold: parseFloat(e.target.value) })}
          className="w-full"
        />
      </label>

      {/* Parakeet backend (client mode only) */}
      {local.transcriptionEngine === "client" && (
        <label className="block mb-2">
          <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">ONNX backend</span>
          <select
            value={local.parakeetBackend}
            onChange={(e) => update({ parakeetBackend: e.target.value as VoiceInputConfig["parakeetBackend"] })}
            className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
          >
            <option value="wasm">WASM (reliable, CPU)</option>
            <option value="webgpu-hybrid">WebGPU Hybrid (fast, GPU + WASM fallback)</option>
          </select>
        </label>
      )}

      {/* Parakeet model URL (client mode only) */}
      {local.transcriptionEngine === "client" && (
        <label className="block mb-2">
          <span className="block mb-0.5 font-medium text-[var(--text-secondary)]">Parakeet model URL</span>
          <input
            type="text"
            value={local.parakeetModelUrl}
            onChange={(e) => update({ parakeetModelUrl: e.target.value })}
            placeholder="Default CDN (Hugging Face)"
            className="w-full px-1.5 py-1 text-xs rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
          />
        </label>
      )}

      <button
        data-testid="voice-input-save"
        onClick={save}
        disabled={saveState === "saving"}
        className={`text-xs px-3 py-1 rounded mt-1 cursor-pointer border-0 ${
          saveState === "saved" ? "bg-green-600 text-white" :
          saveState === "error" ? "bg-red-600 text-white" :
          "bg-[var(--accent-blue)] text-white"
        }`}
      >
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Error" : "Save"}
      </button>
    </div>
  );
}
