/**
 * Voice Input Plugin — server entry
 *
 * Handles server-side speech-to-text transcription.
 * Accumulates audio chunks from the browser until `final: true`,
 * then transcribes the complete recording in a single shot.
 *
 * Single-shot transcription is more reliable than streaming: the TDT model
 * needs enough audio context (~1+ seconds) to produce meaningful tokens.
 * Per-chunk streaming produces blank/empty results because each ~100ms chunk
 * is too short for the encoder to extract useful features.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  initParakeetEngine,
  transcribeWithParakeet,
  transcribeWithWhisper,
  type VoiceInputServerConfig,
} from "./server-transcription.js";

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

  // ── REST route: health check ──────────────────────────────────────────────

  ctx.fastify.get("/api/voice-input/health", async () => {
    const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();
    return {
      ok: true,
      engine: currentCfg.serverEngine,
      transcriptionEngine: currentCfg.transcriptionEngine,
      modelRepo: currentCfg.serverEngine === "parakeet-onnx" ? currentCfg.parakeetModelRepo : null,
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
