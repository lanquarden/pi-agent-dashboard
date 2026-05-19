/**
 * Voice Input Plugin — server entry
 *
 * Handles server-side speech-to-text transcription.
 * Receives audio chunks from the browser via plugin WebSocket messages,
 * processes them through Parakeet ONNX (onnxruntime-node) or OpenAI Whisper API,
 * and streams transcription results back.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  initParakeetEngine,
  transcribeWithParakeet,
  transcribeWithWhisper,
  type VoiceInputServerConfig,
} from "./server-transcription.js";

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const cfg = ctx.getPluginConfig<VoiceInputServerConfig>();

  // Only register handlers if server-side transcription is configured.
  if (cfg.transcriptionEngine !== "server") {
    ctx.logger.info("voice-input server entry: client-mode, no server handlers registered");
    return;
  }

  ctx.logger.info(`voice-input server entry: server-mode with engine=${cfg.serverEngine}`);

  // Initialize the Parakeet ONNX engine (downloads models on first use)
  if (cfg.serverEngine === "parakeet-onnx") {
    try {
      await initParakeetEngine(cfg);
      ctx.logger.info("voice-input: Parakeet ONNX engine initialized");
    } catch (err) {
      ctx.logger.error(`voice-input: failed to init Parakeet engine: ${(err as Error).message}`);
      // Continue — will attempt init on first transcription request
    }
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

    if (!chunk) {
      ctx.logger.warn(`voice_input_audio received with no chunk for session ${sessionId}`);
      return;
    }

    ctx.logger.info(`voice_input_audio chunk ${sessionId} size=${chunk.length} final=${isFinal}`);

    try {
      let text: string;
      const currentCfg = ctx.getPluginConfig<VoiceInputServerConfig>();

      if (currentCfg.serverEngine === "openai-whisper") {
        text = await transcribeWithWhisper(chunk, currentCfg);
      } else {
        text = await transcribeWithParakeet(sessionId, chunk, !!isFinal, currentCfg);
      }

      if (text) {
        ctx.broadcastToSubscribers({
          type: "voice_input_transcript",
          sessionId,
          text,
          partial: !isFinal,
        });

        ctx.logger.info(`voice_input result ${sessionId} len=${text.length} final=${isFinal}`);
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

  ctx.fastify.get("/api/voice-input/health", async () => ({
    ok: true,
    engine: cfg.serverEngine,
    transcriptionEngine: cfg.transcriptionEngine,
    modelRepo: cfg.serverEngine === "parakeet-onnx" ? cfg.parakeetModelRepo : null,
  }));

  ctx.logger.info("voice-input server entry ready");
}
