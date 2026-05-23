/**
 * Shared StreamingTranscriber — orchestrator for real-time speech-to-text.
 *
 * Wires together:
 *   IAudioSource → IRingBuffer → EnergyVAD → WindowBuilder
 *   → ITranscriptionEngine → UtteranceBasedMerger → StreamingCallbacks
 *
 * Platform-independent. Client and server provide adapters implementing
 * the abstract interfaces.
 *
 * Algorithm per audio chunk:
 *   1. Push to ring buffer
 *   2. Run VAD
 *   3. Build window (via WindowBuilder)
 *   4. If window built: extract audio → transcribe (with incremental cache) → merge → emit partial
 */
import type {
  IAudioSource,
  IRingBuffer,
  IVAD,
  ITranscriptionEngine,
  StreamingCallbacks,
} from "./types.js";
import type { WindowBuilder, TranscriptionWindow } from "./WindowBuilder.js";
import type { UtteranceBasedMerger } from "./UtteranceBasedMerger.js";

export class StreamingTranscriber {
  private audioSource: IAudioSource;
  private ringBuffer: IRingBuffer;
  private vad: IVAD;
  private windowBuilder: WindowBuilder;
  private engine: ITranscriptionEngine;
  private merger: UtteranceBasedMerger;
  private callbacks: StreamingCallbacks;

  private isRunning: boolean = false;
  private unsubAudio: (() => void) | null = null;
  private processingWindow: boolean = false;

  private readonly sampleRate = 16000;

  constructor(opts: {
    audioSource: IAudioSource;
    ringBuffer: IRingBuffer;
    vad: IVAD;
    windowBuilder: WindowBuilder;
    engine: ITranscriptionEngine;
    merger: UtteranceBasedMerger;
    callbacks: StreamingCallbacks;
  }) {
    this.audioSource = opts.audioSource;
    this.ringBuffer = opts.ringBuffer;
    this.vad = opts.vad;
    this.windowBuilder = opts.windowBuilder;
    this.engine = opts.engine;
    this.merger = opts.merger;
    this.callbacks = opts.callbacks;
  }

  /**
   * Start capturing audio and processing chunks.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.unsubAudio = this.audioSource.onChunk((chunk) => {
      this.handleChunk(chunk).catch((err) => {
        this.callbacks.onError?.(err);
      });
    });

    await this.audioSource.start();
  }

  /**
   * Stop capturing, finalize all pending text, and return the full transcript.
   */
  stop(): string {
    this.isRunning = false;
    this.audioSource.stop();
    this.unsubAudio?.();
    this.unsubAudio = null;

    this.merger.forceFinalizeAll();
    return this.merger.getFullText();
  }

  /**
   * Reset all state for a new recording session.
   */
  reset(): void {
    this.ringBuffer.reset();
    this.vad.reset();
    this.windowBuilder.reset();
    this.merger.reset();
    this.engine.resetCache?.();
    this.processingWindow = false;
  }

  // ── Chunk processing ─────────────────────────────────────────────────────

  private async handleChunk(chunk: Float32Array): Promise<void> {
    if (!this.isRunning) return;

    // 1. Push to ring buffer
    this.ringBuffer.write(chunk);

    // 2. Run VAD
    this.vad.process(chunk);

    // 3. Build window
    const window = this.windowBuilder.buildWindow();
    if (!window) return;

    // 4. Guard against concurrent window processing
    if (this.processingWindow) return;
    this.processingWindow = true;

    try {
      await this.processWindow(window);
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      this.processingWindow = false;
    }
  }

  private async processWindow(window: TranscriptionWindow): Promise<void> {
    // Extract audio from ring buffer
    const audio = this.ringBuffer.read(window.startFrame, window.endFrame);
    if (audio.length === 0) return;

    const timeOffset = window.startFrame / this.sampleRate;
    const overlapSec = this.windowBuilder.getMatureCursorTime();

    // Transcribe with incremental cache for overlap reuse
    const result = await this.engine.transcribe(audio, this.sampleRate, {
      returnTimestamps: true,
      returnTokenIds: true,
      timeOffset,
      frameStride: 1,
      ...(overlapSec > 0
        ? {
            incremental: {
              cacheKey: "streaming",
              prefixSeconds: overlapSec,
            },
          }
        : {}),
    });

    // Feed into merger
    const mergerResult = await this.merger.processASRResult({
      utterance_text: result.utterance_text,
      words: result.words?.map((w) => ({
        text: w.text,
        start_time: w.start_time,
        end_time: w.end_time,
        confidence: w.confidence,
      })),
      end_time: window.endFrame / this.sampleRate,
    });

    // Advance the window builder's mature cursor
    this.windowBuilder.advanceMatureCursorByTime(mergerResult.matureCursorTime);

    // Emit partial result
    this.callbacks.onPartial({
      matureText: mergerResult.matureText,
      pendingText: mergerResult.immatureText,
      fullText: mergerResult.fullText,
    });
  }
}
