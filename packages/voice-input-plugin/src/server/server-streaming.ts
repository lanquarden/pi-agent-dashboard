/**
 * Server-side streaming session manager.
 *
 * Creates and manages per-session StreamingTranscriber instances.
 * Handles chunk routing, session lifecycle, and stale cleanup.
 */
import { StreamingTranscriber } from "../shared/streaming/StreamingTranscriber.js";
import { EnergyVAD } from "../shared/streaming/EnergyVAD.js";
import { WindowBuilder } from "../shared/streaming/WindowBuilder.js";
import { UtteranceBasedMerger } from "../shared/streaming/UtteranceBasedMerger.js";
import { WebSocketAudioSource } from "./adapters/WebSocketAudioSource.js";
import { NodeRingBuffer } from "./adapters/NodeRingBuffer.js";
import { NodeInferenceEngine } from "./adapters/NodeInferenceEngine.js";

interface StreamSession {
  audioSource: WebSocketAudioSource;
  transcriber: StreamingTranscriber;
  createdAt: number;
  lastChunkAt: number;
  seq: number; // For ordering partial results
}

const sessions = new Map<string, StreamSession>();
const SESSION_TTL_MS = 30_000;

/**
 * Create or retrieve a streaming session for the given sessionId.
 */
export function getOrCreateStream(
  sessionId: string,
  getModel: () => Promise<Record<string, unknown>>,
  onPartial: (sessionId: string, matureText: string, pendingText: string, seq: number) => void,
  onError: (sessionId: string, error: string) => void,
): StreamSession {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastChunkAt = Date.now();
    return existing;
  }

  const audioSource = new WebSocketAudioSource();
  const ringBuffer = new NodeRingBuffer(120, 16000);
  const vad = new EnergyVAD({ sampleRate: 16000 });
  const engine = new NodeInferenceEngine(getModel);
  const windowBuilder = new WindowBuilder(ringBuffer, vad, {
    sampleRate: 16000,
    minDurationSec: 3.0,
    maxDurationSec: 30.0,
    minInitialDurationSec: 1.5,
    debug: false,
  });
  const merger = new UtteranceBasedMerger({ useNLP: true });

  let seq = 0;

  const transcriber = new StreamingTranscriber({
    audioSource,
    ringBuffer,
    vad,
    windowBuilder,
    engine,
    merger,
    callbacks: {
      onPartial: (result) => {
        const currentSeq = seq++;
        // For server-side transcription we don't have proper word timestamps,
        // so the UtteranceBasedMerger can't deduplicate across overlapping
        // windows. Instead, emit the raw full text as both mature and pending
        // — the client replaces on each update so only the latest full
        // transcription is visible.
        onPartial(sessionId, result.fullText, "", currentSeq);
      },
      onError: (err) => {
        onError(sessionId, err.message);
      },
    },
  });

  const session: StreamSession = {
    audioSource,
    transcriber,
    createdAt: Date.now(),
    lastChunkAt: Date.now(),
    seq: 0,
  };

  sessions.set(sessionId, session);

  // Start the transcriber (this subscribes to audioSource.onChunk)
  transcriber.start().catch((err: Error) => {
    onError(sessionId, `Failed to start stream: ${err.message}`);
  });

  return session;
}

/**
 * Push a decoded PCM chunk to the session's transcriber.
 */
export function pushChunk(sessionId: string, chunk: Float32Array): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.lastChunkAt = Date.now();
  session.audioSource.pushChunk(chunk);
}

/**
 * Stop the stream, finalize all text, and destroy the transcriber.
 * Returns the full transcript.
 */
export function stopStream(sessionId: string): string {
  const session = sessions.get(sessionId);
  if (!session) return "";

  const fullText = session.transcriber.stop();
  sessions.delete(sessionId);
  return fullText;
}

/**
 * Remove stale sessions that haven't received chunks within TTL.
 */
export function cleanupStale(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastChunkAt > SESSION_TTL_MS) {
      session.transcriber.stop();
      sessions.delete(id);
    }
  }
}

// Periodic cleanup every 30s
const cleanupInterval = setInterval(cleanupStale, 30_000);
// Allow Node to exit even if interval is active
if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
  (cleanupInterval as NodeJS.Timeout).unref();
}
