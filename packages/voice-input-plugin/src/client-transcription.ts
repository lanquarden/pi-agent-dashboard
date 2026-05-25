/**
 * Client-side transcription pipeline using parakeet.js.
 *
 * Manages the parakeet.js lifecycle: dynamic import, model loading (lazy, cached),
 * and streaming transcription of PCM audio chunks.
 *
 * Model download is deferred until first use. Once loaded, the model and streamer
 * are reused across recording sessions.
 */
// @ts-nocheck — parakeet.js is dynamically imported; no types available
import type { VoiceInputConfig } from "./client.js";

// ── Types from parakeet.js (dynamic imports — no static dependency) ──────────

interface ParakeetModel {
  createStreamingTranscriber(opts: StreamingOpts): StreamingTranscriber;
}

interface StreamingOpts {
  returnTimestamps?: boolean;
  returnConfidences?: boolean;
  sampleRate?: number;
}

interface StreamingTranscriber {
  processChunk(audio: Float32Array): Promise<StreamingResult>;
  finalize(): StreamingResult;
  reset(): void;
}

interface StreamingResult {
  chunkText: string;
  text: string;
  words: Array<{ text: string; start_time?: number; end_time?: number }>;
  is_final: boolean;
}

interface FromHubOptions {
  backend?: "webgpu" | "wasm";
  encoderQuant?: "int8" | "fp32" | "fp16";
  decoderQuant?: "int8" | "fp32" | "fp16";
  preprocessorBackend?: "js" | "onnx";
  progress?: (info: { loaded: number; total: number }) => void;
  [key: string]: unknown;
}

interface FromUrlsConfig {
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
  preprocessorUrl?: string;
  backend?: "webgpu" | "wasm";
  preprocessorBackend?: "js" | "onnx";
  progress?: (info: { loaded: number; total: number }) => void;
  [key: string]: unknown;
}

interface ParakeetModule {
  fromHub: (repoId: string, opts?: FromHubOptions) => Promise<ParakeetModel>;
  fromUrls: (cfg: FromUrlsConfig) => Promise<ParakeetModel>;
}

// ── Module-level cache ───────────────────────────────────────────────────────

let _parakeetModule: ParakeetModule | null = null;
let _model: ParakeetModel | null = null;
let _streamer: StreamingTranscriber | null = null;
let _loadPromise: Promise<ParakeetModel> | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Dynamically import parakeet.js (only when needed).
 * The library is ~600MB of ONNX models downloaded from HuggingFace at runtime —
 * we never bundle it into the app build.
 */
async function getParakeet(): Promise<ParakeetModule> {
  if (!_parakeetModule) {
    _parakeetModule = await import("parakeet.js");
  }
  return _parakeetModule!;
}

/**
 * Load the Parakeet ONNX model from HuggingFace or a custom URL.
 *
 * On first call: downloads model files, compiles ONNX sessions, caches result.
 * Subsequent calls return the cached model immediately.
 */
export async function loadModel(
  config: VoiceInputConfig,
  onProgress?: (pct: number) => void,
): Promise<ParakeetModel> {
  if (_model) return _model;

  // Deduplicate concurrent loads
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    const pk = await getParakeet();

    const progressCb = onProgress
      ? ({ loaded, total }: { loaded: number; total: number }) => {
          onProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        }
      : undefined;

    if (config.parakeetModelUrl) {
      const model = await pk.fromUrls({
        encoderUrl: `${config.parakeetModelUrl}/encoder-model.onnx`,
        decoderUrl: `${config.parakeetModelUrl}/decoder_joint-model.onnx`,
        tokenizerUrl: `${config.parakeetModelUrl}/vocab.txt`,
        preprocessorUrl: `${config.parakeetModelUrl}/nemo128.onnx`,
        backend: "webgpu-hybrid",
        preprocessorBackend: "js",
        progress: progressCb,
      });
      _model = model;
    } else {
      const repoId = config.parakeetModelRepo || "ysdede/parakeet-tdt-0.6b-v3-onnx";
      // Use the configured backend (default: "wasm" for reliability).
      // "webgpu-hybrid" is faster when WebGPU works, but produces silent
      // zombie sessions when the adapter is unavailable.
      const backend = config.parakeetBackend || "wasm";
      const model = await pk.fromHub(repoId, {
        backend,
        encoderQuant: "fp32",
        decoderQuant: "int8",
        preprocessorBackend: "js",
        cpuThreads: 4,
        progress: progressCb,
      });
      _model = model;
    }

    _loadPromise = null;
    return _model;
  })();

  return _loadPromise;
}

/**
 * Create or reuse a streaming transcriber for the loaded model.
 */
export function getStreamer(model: ParakeetModel): StreamingTranscriber {
  if (!_streamer) {
    _streamer = model.createStreamingTranscriber({
      returnTimestamps: false,
      returnConfidences: false,
      sampleRate: 16000,
      debug: true,
    });
  }
  return _streamer;
}

/**
 * Transcribe accumulated audio chunks using a single-shot (non-streaming)
 * call. Streaming mode was producing only the first utterance ("Yeah.") and
 * then "." for all subsequent chunks — the decoder state got stuck. Single-shot
 * lets the model see the full audio context at once.
 */
export async function transcribeChunks(
  chunks: Float32Array[],
  model: ParakeetModel,
): Promise<string> {
  if (chunks.length === 0) return "";

  // Concatenate all chunks into one buffer
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const fullAudio = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    fullAudio.set(chunk, offset);
    offset += chunk.length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (model as any).transcribe(fullAudio, 16000, {
    returnTimestamps: false,
    language: "en",
  });

  return (result?.utterance_text || result?.text || "").trim();
}

export function resetStreamer(): void {
  _streamer?.reset();
}

export function isModelLoaded(): boolean {
  return _model !== null;
}

export function isLoadingModel(): boolean {
  return _loadPromise !== null;
}

export function destroyModel(): void {
  _model = null;
  _streamer = null;
  _loadPromise = null;
}
