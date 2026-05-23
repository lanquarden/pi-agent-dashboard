/**
 * Voice Input Plugin — server entry
 *
 * Handles server-side speech-to-text transcription.
 * Supports two modes:
 *   - One-shot: accumulate all chunks → transcribe on `final: true` (existing)
 *   - Streaming: real-time partial results via windowed transcription (new)
 *
 * The one-shot path uses the TDT frame-by-frame decoder in server-transcription.ts.
 * The streaming path uses the shared StreamingTranscriber core with parakeet.js's
 * native model.transcribe() (which uses the same ONNX models but leverages
 * parakeet.js's internal incremental caching for overlap reuse).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  initParakeetEngine,
  transcribeWithParakeet,
  transcribeWithWhisper,
  ensureParakeetModel,
  type VoiceInputServerConfig,
} from "./server-transcription.js";
import {
  getOrCreateStream,
  pushChunk,
  stopStream,
} from "./server-streaming.js";

// ── Chunk accumulator ────────────────────────────────────────────────────────
// Audio chunks arrive one-by-one from the browser (each ~100ms of 16kHz PCM).
// Accumulate until `final: true`, then decode + transcribe the full recording.

interface PendingRecording {
  chunks: string[];  // base64-encoded Float32Array PCM
  receivedAt: number; // Date.now() when first chunk arrived
}

const pendingRecordings = new Map<string, PendingRecording>();
const RECORDING_TTL_MS = 30_000; // drop abandoned recordings after 30s

function cleanupStale(): void {
  const now = Date.now();
  for (const [sessionId, rec] of pendingRecordings) {
    if (now - rec.receivedAt > RECORDING_TTL_MS) {
      pendingRecordings.delete(sessionId);
    }
  }
}

// Periodic cleanup every 30s
const cleanupInterval = setInterval(cleanupStale, 30_000);
// Allow Node to exit even if the interval is still active
cleanupInterval.unref();

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const cfg = ctx.getPluginConfig<VoiceInputServerConfig>();

  ctx.logger.info(`voice-input server entry: engine=${cfg.transcriptionEngine}/${cfg.serverEngine}`);

  // Pre-initialize the Parakeet ONNX engine (downloads models on first use).
  // Fire-and-forget so download doesn't block the HTTP server from starting.
  // First transcription request will also trigger download if not yet complete.
  if (cfg.transcriptionEngine === "server" && cfg.serverEngine === "parakeet-onnx") {
    initParakeetEngine(cfg)
      .then(() => ctx.logger.info("voice-input: Parakeet ONNX engine initialized"))
      .catch((err) => ctx.logger.error(`voice-input: failed to init Parakeet engine: ${(err as Error).message}`));
  }

  // ── Browser handler: voice_input_audio ─────────────────────────────────────
  // Protocol:
  //   Browser → Server: { type: "voice_input_audio", sessionId, chunk: "<base64>", final: boolean }
  //   Server → Browser: { type: "voice_input_transcript", sessionId, text: "...", partial: boolean }

  ctx.registerBrowserHandler("voice_input_audio", async (msg, _ws) => {
    const { sessionId, chunk, final: isFinal } = msg as {
      type: string;
      sessionId: string;
      chunk?: string;
      final?: boolean;
    };

    // Ignore messages when client-side transcription is configured
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    if (currentCfg.transcriptionEngine !== "server") return;

    if (!chunk) {
      ctx.logger.warn(`voice_input_audio received with no chunk for session ${sessionId}`);
      return;
    }

    ctx.logger.info(`voice_input_audio chunk ${sessionId} size=${chunk.length} final=${isFinal}`);

    // Accumulate chunks until the final one arrives
    let recording = pendingRecordings.get(sessionId);
    if (!recording) {
      recording = { chunks: [], receivedAt: Date.now() };
      pendingRecordings.set(sessionId, recording);
    }
    recording.chunks.push(chunk);

    // Only transcribe when all chunks have arrived
    if (!isFinal) return;

    // Take ownership of the accumulated chunks and remove from pending
    const allChunks = recording.chunks;
    pendingRecordings.delete(sessionId);

    const totalSize = allChunks.reduce((sum, c) => sum + c.length, 0);
    ctx.logger.info(`voice_input transcribing ${sessionId} chunks=${allChunks.length} totalBase64=${totalSize}`);

    try {
      if (currentCfg.serverEngine === "openai-whisper") {
        // Whisper: concatenate raw PCM, convert to WAV, send to API
        const combinedB64 = concatenateBase64Chunks(allChunks);
        const text = await transcribeWithWhisper(combinedB64, currentCfg);
        if (text) {
          ctx.broadcastToSubscribers({
            type: "voice_input_transcript",
            sessionId,
            text,
            partial: false,
          });
          ctx.logger.info(`voice_input whisper result ${sessionId} len=${text.length}`);
        }
      } else {
        // Parakeet ONNX: decode all PCM to Float32Array, single-shot transcribe
        const combinedPcm = concatenateBase64Pcm(allChunks);
        const text = await transcribeWithParakeet(combinedPcm, currentCfg);
        if (text) {
          ctx.broadcastToSubscribers({
            type: "voice_input_transcript",
            sessionId,
            text,
            partial: false,
          });
          ctx.logger.info(`voice_input parakeet result ${sessionId} len=${text.length}`);
        } else {
          ctx.logger.warn(`voice_input parakeet returned empty text for ${sessionId}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`voice_input error ${sessionId}: ${message}`);

      ctx.broadcastToSubscribers({
        type: "voice_input_transcript",
        sessionId,
        text: "",
        partial: false,
        error: message,
      });
    }
  });

  // ── Streaming handlers (opt-in via streamEnabled config) ──────────────────
  //
  // Protocol:
  //   Browser → Server:  voice_input_stream_start  { sessionId }
  //                       voice_input_stream_chunk  { sessionId, chunk: "<base64>", seq: number }
  //                       voice_input_stream_stop   { sessionId }
  //   Server → Browser:   voice_input_partial       { sessionId, matureText, pendingText, seq }
  //                       voice_input_final          { sessionId, fullText }

  // Lazy model loader for the streaming inference engine.
  // Uses the existing ensureParakeetModel from server-transcription.ts
  // which downloads ONNX models from HuggingFace on first use.
  const getStreamingModel = async (): Promise<Record<string, unknown>> => {
    const repoId = cfg.parakeetModelRepo || "ysdede/parakeet-tdt-0.6b-v3-onnx";
    // ensureParakeetModel downloads + caches ONNX model files to disk.
    await ensureParakeetModel(repoId);

    // parakeet.js fromUrls uses onnxruntime-web which is incompatible
    // with Node.js (it does dynamic import() of HTTPS URLs). Instead,
    // return a thin wrapper around transcribeWithParakeet which already
    // uses onnxruntime-node and the locally cached model files.
    //
    // Caveat: incremental decoder cache is not supported — each streaming
    // window is transcribed independently. This is slower (redundant
    // encoder passes) but correct.
    return {
      transcribe: async (
        audio: Float32Array,
        _sampleRate: number,
        _opts?: Record<string, unknown>,
      ) => {
        const text = await transcribeWithParakeet(audio, {
          ...cfg,
          parakeetModelRepo: repoId,
        });
        // transcribeWithParakeet does TDT decoding without per-word timestamps.
        // Generate synthetic word timestamps anchored at timeOffset so the
        // UtteranceBasedMerger can deduplicate across overlapping windows.
        // Words are spaced ~0.25s apart (typical speaking rate).
        const timeOffset = (Number(_opts?.timeOffset) || 0);
        const wordsPerSec = 4; // approximate words per second
        const secPerWord = 1 / wordsPerSec;
        const words = text
          ? text.split(/\s+/).filter(Boolean).map((w: string, i: number) => ({
              text: w,
              start_time: timeOffset + i * secPerWord,
              end_time: timeOffset + (i + 1) * secPerWord,
              confidence: 0.9,
            }))
          : [];
        return { utterance_text: text, words };
      },
      resetMelCache: () => {},
    };
  };

  ctx.registerBrowserHandler("voice_input_stream_start", async (msg) => {
    const { sessionId } = msg as { type: string; sessionId: string };
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    if (currentCfg.transcriptionEngine !== "server") return;
    if (!currentCfg.streamEnabled) return;

    ctx.logger.info(`voice_input stream start ${sessionId}`);

    getOrCreateStream(
      sessionId,
      getStreamingModel,
      (sid, matureText, pendingText, seq) => {
        ctx.broadcastToSubscribers({
          type: "voice_input_partial",
          sessionId: sid,
          matureText,
          pendingText,
          seq,
        });
      },
      (sid, error) => {
        ctx.logger.error(`voice_input stream error ${sid}: ${error}`);
        ctx.broadcastToSubscribers({
          type: "voice_input_final",
          sessionId: sid,
          fullText: "",
          error,
        });
      },
    );
  });

  ctx.registerBrowserHandler("voice_input_stream_chunk", async (msg) => {
    const { sessionId, chunk: base64Chunk } = msg as {
      type: string;
      sessionId: string;
      chunk: string;
      seq: number;
    };
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    if (currentCfg.transcriptionEngine !== "server") return;
    if (!currentCfg.streamEnabled) return;
    if (!base64Chunk) return;

    const buf = Buffer.from(base64Chunk, "base64");
    const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    pushChunk(sessionId, pcm);
  });

  ctx.registerBrowserHandler("voice_input_stream_stop", async (msg) => {
    const { sessionId } = msg as { type: string; sessionId: string };
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    if (currentCfg.transcriptionEngine !== "server") return;
    if (!currentCfg.streamEnabled) return;

    ctx.logger.info(`voice_input stream stop ${sessionId}`);

    const fullText = stopStream(sessionId);
    ctx.broadcastToSubscribers({
      type: "voice_input_final",
      sessionId,
      fullText,
    });
  });

  // ── REST route: health check ──────────────────────────────────────────────

  ctx.fastify.get("/api/voice-input/health", async () => {
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    return {
      ok: true,
      engine: currentCfg.serverEngine,
      transcriptionEngine: currentCfg.transcriptionEngine,
      modelRepo: currentCfg.serverEngine === "parakeet-onnx" ? currentCfg.parakeetModelRepo : null,
      streamEnabled: currentCfg.streamEnabled ?? false,
    };
  });

  ctx.logger.info("voice-input server entry ready");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Concatenate multiple base64-encoded Float32Array chunks into a single
 * Float32Array. Each chunk is a standalone base64 string; the combined
 * result is the contiguous PCM waveform.
 */
function concatenateBase64Pcm(chunks: string[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  if (chunks.length === 1) {
    const buf = Buffer.from(chunks[0], "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  // Decode all chunks and compute total length
  const decoded: Float32Array[] = chunks.map((c) => {
    const buf = Buffer.from(c, "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  });
  const totalSamples = decoded.reduce((sum, arr) => sum + arr.length, 0);

  // Concatenate into single buffer
  const result = new Float32Array(totalSamples);
  let offset = 0;
  for (const arr of decoded) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Concatenate multiple base64-encoded raw PCM chunks into a single base64
 * string (for Whisper path which expects one combined chunk).
 */
function concatenateBase64Chunks(chunks: string[]): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0];
  const combined = concatenateBase64Pcm(chunks);
  const buf = Buffer.from(combined.buffer);
  return buf.toString("base64");
}
