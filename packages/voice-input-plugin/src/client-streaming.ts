/**
 * useStreamingTranscription — React hook for client-side streaming transcription.
 *
 * Manages the StreamingTranscriber lifecycle and exposes reactive state
 * for mature/pending text display.
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transcriberRef.current?.stop();
      engineRef.current?.dispose();
    };
  }, []);

  const start = useCallback(async () => {
    if (transcriberRef.current) {
      transcriberRef.current.reset();
      await transcriberRef.current.start();
      setState((prev) => ({ ...prev, isListening: true, error: null }));
      return;
    }

    try {
      const audioSource = new BrowserAudioSource(16000);
      const ringBuffer = new BrowserRingBuffer(120, 16000);
      const vad = new EnergyVAD({ sampleRate: 16000 });
      const engine = new BrowserInferenceEngine();
      engineRef.current = engine;

      const windowBuilder = new WindowBuilder(ringBuffer, vad, {
        sampleRate: 16000,
        minDurationSec: 3.0,
        maxDurationSec: 30.0,
        minInitialDurationSec: 1.5,
        debug: false,
      });

      const merger = new UtteranceBasedMerger({ useNLP: true });

      const transcriber = new StreamingTranscriber({
        audioSource,
        ringBuffer,
        vad,
        windowBuilder,
        engine,
        merger,
        callbacks: {
          onPartial: (result) => {
            setState((prev) => ({
              ...prev,
              matureText: result.matureText,
              pendingText: result.pendingText,
            }));
          },
          onError: (err) => {
            setState((prev) => ({ ...prev, error: err.message }));
          },
        },
      });

      transcriberRef.current = transcriber;
      await transcriber.start();

      setState((prev) => ({ ...prev, isListening: true, error: null }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: msg, isListening: false }));
    }
  }, []);

  const stop = useCallback((): string | null => {
    if (!transcriberRef.current) return null;
    const fullText = transcriberRef.current.stop();
    transcriberRef.current = null;
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
