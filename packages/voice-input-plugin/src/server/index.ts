/**
 * Voice Input Plugin — server entry
 *
 * Handles server-side speech-to-text transcription.
 * Receives audio chunks from the browser via plugin WebSocket messages,
 * processes them through whisper.cpp or OpenAI Whisper API,
 * and streams transcription results back.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";

interface VoiceInputConfig {
  mode: "push-to-talk" | "toggle";
  transcriptionEngine: "client" | "server";
  language: string;
  serverEngine: "parakeet-onnx" | "openai-whisper";
  openaiApiKey: string;
  parakeetModelRepo: string;
  vadThreshold: number;
  parakeetModelUrl: string;
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const cfg = ctx.pluginConfig as VoiceInputConfig;

  // Only register handlers if server-side transcription is configured.
  if (cfg.transcriptionEngine !== "server") {
    ctx.logger.info("voice-input server entry: client-mode, no server handlers registered");
    return;
  }

  ctx.logger.info(`voice-input server entry: server-mode with engine=${cfg.serverEngine}`);

  // ── Browser handler: voice_input_audio_chunk ──────────────────────────────
  // Receives audio chunks from the browser (base64-encoded PCM float32).
  //
  // Protocol:
  //   Browser → Server: { type: "voice_input_audio", sessionId, chunk: "<base64>", final: boolean }
  //   Server → Browser: { type: "voice_input_transcript", sessionId, text: "...", partial: boolean }
  //
  // TODO: Implement actual onnxruntime-node + Parakeet ONNX inference.
  // Approach:
  //   1. Load ONNX models (encoder, decoder) via onnxruntime-node from HuggingFace
  //   2. Mel spectrogram preprocessing (pure JS, same algorithm as parakeet.js)
  //   3. Encoder inference → decoder inference → tokenizer → text
  //   4. Stateful streaming: cache previous decoder state for next chunk
  // Current: stub.

  ctx.registerBrowserHandler("voice_input_audio", async (msg, _ws) => {
    const { sessionId, chunk, final: isFinal } = msg as {
      type: string;
      sessionId: string;
      chunk?: string;
      final?: boolean;
    };

    ctx.logger.debug({ sessionId, chunkSize: chunk?.length, isFinal }, "voice_input_audio received");

    if (isFinal && chunk) {
      const placeholderText = `[Voice transcription for session ${sessionId}]`;

      ctx.broadcastToSubscribers({
        type: "voice_input_transcript",
        sessionId,
        text: placeholderText,
        partial: false,
      });

      ctx.logger.info({ sessionId }, "voice_input transcription complete (placeholder)");
    }
  });

  // ── REST route: health check ──────────────────────────────────────────────

  ctx.fastify.get("/api/voice-input/health", async () => ({
    ok: true,
    engine: cfg.serverEngine,
    transcriptionEngine: cfg.transcriptionEngine,
    modelRepo: cfg.serverEngine === "parakeet-onnx" ? cfg.parakeetModelRepo : null,
  }));

  ctx.logger.info("voice-input server entry ready");
}
