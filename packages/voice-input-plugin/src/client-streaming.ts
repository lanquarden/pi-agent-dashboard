/**
 * useStreamingTranscription — React hook for client-side streaming transcription.
 *
 * Manages the StreamingTranscriber lifecycle and exposes reactive state
 * for mature/pending text display.
 *
 * @param model - Pre-loaded parakeet model (from client-transcription.ts loadModel()).
 *   Must be loaded before calling start().
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { StreamingTranscriber } from "./shared/streaming/StreamingTranscriber.js";
import { EnergyVAD } from "./shared/streaming/EnergyVAD.js";
import { WindowBuilder } from "./shared/streaming/WindowBuilder.js";
import { UtteranceBasedMerger } from "./shared/streaming/UtteranceBasedMerger.js";
import { BrowserAudioSource } from "./client/adapters/BrowserAudioSource.js";
import { BrowserRingBuffer } from "./client/adapters/BrowserRingBuffer.js";
import { BrowserInferenceEngine } from "./client/adapters/BrowserInferenceEngine.js";

/** Minimal config shape needed for streaming — avoids circular import from ../client.tsx. */
export interface StreamingConfig {
  parakeetModelRepo?: string;
  parakeetModelUrl?: string;
  parakeetBackend?: string;
}

export interface StreamingState {
  matureText: string;
  pendingText: string;
  isListening: boolean;
  error: string | null;
}

export function useStreamingTranscription(_config: StreamingConfig) {
  const [state, setState] = useState<StreamingState>({
    matureText: "",
    pendingText: "",
    isListening: false,
    error: null,
  });

  const transcriberRef = useRef<StreamingTranscriber | null>(null);
  const engineRef = useRef<BrowserInferenceEngine | null>(null);
  const modelRef = useRef<any>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transcriberRef.current?.stop();
      engineRef.current?.dispose();
    };
  }, []);

  /**
   * Start streaming transcription. Requires a pre-loaded parakeet model.
   *
   * @param model - Pre-loaded parakeet model from client-transcription.ts loadModel().
   */
  const start = useCallback(async (model?: any) => {
    const effectiveModel = model || modelRef.current;

    if (transcriberRef.current) {
      transcriberRef.current.reset();
      await transcriberRef.current.start();
      setState((prev) => ({ ...prev, isListening: true, error: null }));
      return;
    }

    console.debug("[voice-input] streaming start: creating pipeline");

    try {
      const audioSource = new BrowserAudioSource(16000);
      const ringBuffer = new BrowserRingBuffer(120, 16000);
      const vad = new EnergyVAD({ sampleRate: 16000, energyThreshold: 0.08 });
      const engine = new BrowserInferenceEngine(effectiveModel);
      engineRef.current = engine;

      const windowBuilder = new WindowBuilder(ringBuffer, vad, {
        sampleRate: 16000,
        minDurationSec: 5.0,
        maxDurationSec: 30.0,
        minInitialDurationSec: 3.0,
        debug: true,
      });

      const merger = new UtteranceBasedMerger({ useNLP: true, debug: true });

      const transcriber = new StreamingTranscriber({
        audioSource,
        ringBuffer,
        vad,
        windowBuilder,
        engine,
        merger,
        callbacks: {
          onPartial: (result) => {
            console.debug("[voice-input] streaming partial:", {
              mature: result.matureText.slice(0, 40),
              pending: result.pendingText.slice(0, 40),
            });
            setState((prev) => ({
              ...prev,
              matureText: result.matureText,
              pendingText: result.pendingText,
            }));
          },
          onError: (err) => {
            console.warn("[voice-input] streaming error:", err.message);
            setState((prev) => ({ ...prev, error: err.message }));
          },
        },
      });

      transcriberRef.current = transcriber;
      await transcriber.start();

      console.debug("[voice-input] streaming pipeline started");
      setState((prev) => ({ ...prev, isListening: true, error: null }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[voice-input] streaming start failed:", msg);
      setState((prev) => ({ ...prev, error: msg, isListening: false }));
    }
  }, []);

  const stop = useCallback((): string | null => {
    if (!transcriberRef.current) return null;
    console.debug("[voice-input] streaming stop");
    const fullText = transcriberRef.current.stop();
    transcriberRef.current = null;
    console.debug("[voice-input] streaming final text:", { text: fullText.slice(0, 80), len: fullText.length });
    setState({
      matureText: "",
      pendingText: "",
      isListening: false,
      error: null,
    });
    return fullText;
  }, []);

  return { ...state, start, stop };
}
