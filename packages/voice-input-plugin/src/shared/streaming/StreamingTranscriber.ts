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

  // Guard against stuck-loop: when consecutive windows from the same
  // mature cursor position produce empty text, advance the cursor anyway
  // to prevent infinite re-transcription of silence.
  private lastMatureCursor: number = 0;
  private consecutiveEmptyFromSameCursor: number = 0;
  private static readonly MAX_EMPTY_FROM_SAME_CURSOR = 4;

  // Silence-based flush: when VAD reports speech end and enough silence
  // accumulates, finalize the pending sentence so mature text appears.
  private silenceAccumSec: number = 0;
  private isInSilence: boolean = false;
  private static readonly SILENCE_FLUSH_SEC = 1.0;

  private readonly sampleRate = 16000;

  // Debug counters
  private chunkCount: number = 0;
  private windowCount: number = 0;

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

    console.debug("[StreamingTranscriber] starting audio capture...");
    this.isRunning = true;
    this.unsubAudio = this.audioSource.onChunk((chunk) => {
      this.handleChunk(chunk).catch((err) => {
        this.callbacks.onError?.(err);
      });
    });

    await this.audioSource.start();
    console.debug("[StreamingTranscriber] audio capture started, sampleRate:", this.sampleRate);
  }

  /**
   * Stop capturing, finalize all pending text, and return the full transcript.
   */
  stop(): string {
    console.debug("[StreamingTranscriber] stopping (chunks:", this.chunkCount, "windows:", this.windowCount, ")");
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
    this.chunkCount = 0;
    this.windowCount = 0;
    this.lastMatureCursor = 0;
    this.consecutiveEmptyFromSameCursor = 0;
    this.silenceAccumSec = 0;
    this.isInSilence = false;
  }

  // ── Chunk processing ─────────────────────────────────────────────────────

  private async handleChunk(chunk: Float32Array): Promise<void> {
    if (!this.isRunning) return;

    this.chunkCount++;

    // Log first few chunks to confirm audio is flowing, then log
    // every 30th chunk + any chunk that triggers a VAD transition.
    if (this.chunkCount <= 5 || this.chunkCount % 30 === 0) {
      let maxAmp = 0;
      for (let i = 0; i < chunk.length; i++) {
        const abs = chunk[i] < 0 ? -chunk[i] : chunk[i];
        if (abs > maxAmp) maxAmp = abs;
      }
      console.debug("[StreamingTranscriber] chunk", this.chunkCount, "samples:", chunk.length, "maxAmp:", maxAmp.toFixed(4));
    }

    // 1. Push to ring buffer
    this.ringBuffer.write(chunk);

    // 2. Run VAD
    const vadResult = this.vad.process(chunk);
    if (vadResult.speechStart || vadResult.speechEnd) {
      // Compute max amplitude for the triggering chunk
      let maxAmp = 0;
      for (let i = 0; i < chunk.length; i++) {
        const abs = chunk[i] < 0 ? -chunk[i] : chunk[i];
        if (abs > maxAmp) maxAmp = abs;
      }
      console.debug(
        "[StreamingTranscriber] VAD:",
        vadResult.speechStart ? "speech start" : "speech end",
        "(chunk", this.chunkCount, "maxAmp:", maxAmp.toFixed(4),
        "energy:", vadResult.energy.toFixed(4),
        "snr:", vadResult.snr?.toFixed(1) ?? "-", "dB)",
      );
    }

    // Silence tracking: after speechEnd, accumulate silence and flush
    // the pending sentence once enough silence has passed. This is how
    // single-sentence utterances get finalized during streaming.
    const chunkDurationSec = chunk.length / this.sampleRate;
    if (vadResult.speechEnd) {
      this.isInSilence = true;
      this.silenceAccumSec = 0;
    } else if (vadResult.speechStart) {
      this.isInSilence = false;
      this.silenceAccumSec = 0;
    } else if (this.isInSilence) {
      this.silenceAccumSec += chunkDurationSec;
      if (this.silenceAccumSec >= StreamingTranscriber.SILENCE_FLUSH_SEC) {
        const flushResult = this.merger.finalizePendingSentenceByTimeout();
        if (flushResult) {
          console.debug(
            "[StreamingTranscriber] silence flush after",
            this.silenceAccumSec.toFixed(1), "s:",
            flushResult.matureText.slice(0, 40),
          );
          this.callbacks.onPartial({
            matureText: flushResult.matureText,
            pendingText: flushResult.immatureText,
            fullText: flushResult.fullText,
          });
          // Advance the cursor to the flushed sentence boundary
          if (flushResult.matureCursorTime > 0) {
            this.windowBuilder.advanceMatureCursorByTime(flushResult.matureCursorTime);
          }
        }
        this.isInSilence = false;
        this.silenceAccumSec = 0;
      }
    }

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
    this.windowCount++;
    console.debug("[StreamingTranscriber] window", this.windowCount, "duration:", window.durationSeconds.toFixed(2), "s", "isInitial:", window.isInitial);

    // Extract audio from ring buffer
    const audio = this.ringBuffer.read(window.startFrame, window.endFrame);
    if (audio.length === 0) {
      console.debug("[StreamingTranscriber] window", this.windowCount, "empty audio — skipping");
      return;
    }

    console.debug("[StreamingTranscriber] window", this.windowCount, "audio samples:", audio.length);

    const overlapSec = this.windowBuilder.getMatureCursorTime();

    // Transcribe. Pass timeOffset so the model returns absolute word timestamps
    // (relative to recording start, not relative to this window). This is critical
    // for the merger's dedup logic and cursor tracking to work across windows.
    // frameStride=1 for normal decoder speed (matching keet's v4 default).
    const result = await this.engine.transcribe(audio, this.sampleRate, {
      returnTimestamps: true,
      timeOffset: window.startFrame / this.sampleRate,
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

    console.debug("[StreamingTranscriber] window", this.windowCount, "transcript:", result.utterance_text.slice(0, 60));

    // Feed into merger
    const incomingWords = result.words?.map((w) => ({
      text: w.text,
      start_time: w.start_time,
      end_time: w.end_time,
      confidence: w.confidence,
    }));
    const mergerResult = this.merger.processASRResult({
      utterance_text: result.utterance_text,
      words: incomingWords,
      end_time: window.endFrame / this.sampleRate,
    });
    console.debug(
      "[StreamingTranscriber] merger result:",
      JSON.stringify({
        matureLen: mergerResult.matureText.length,
        immatureLen: mergerResult.immatureText.length,
        matureCursor: mergerResult.matureCursorTime,
        totalSentences: mergerResult.totalSentences,
        wordCount: incomingWords?.length ?? 0,
        maturePreview: mergerResult.matureText.slice(0, 40),
        immaturePreview: mergerResult.immatureText.slice(0, 40),
      }),
    );

    // ── Stuck-loop guard: if consecutive windows from the same cursor
    //    position produce empty text, advance the cursor anyway.
    //    Prevents infinite re-transcription of silence after speech ends.
    //    Only counts windows that produced NO text — dedup-blocked text
    //    (where matureCursor didn't advance but the model DID transcribe)
    //    doesn't count toward the limit.
    const windowWasEmpty = !result.utterance_text;
    if (windowWasEmpty && mergerResult.matureCursorTime <= this.lastMatureCursor) {
      this.consecutiveEmptyFromSameCursor++;
    } else if (!windowWasEmpty) {
      this.consecutiveEmptyFromSameCursor = 0;
    }
    this.lastMatureCursor = mergerResult.matureCursorTime;

    if (this.consecutiveEmptyFromSameCursor >= StreamingTranscriber.MAX_EMPTY_FROM_SAME_CURSOR) {
      // Force-advance past the stuck region: skip ahead by the window
      // duration so we don't re-transcribe the same silence forever.
      console.debug(
        "[StreamingTranscriber] stuck-loop guard: advancing cursor",
        window.durationSeconds.toFixed(2), "s past empty region",
      );
      this.windowBuilder.advanceMatureCursorByTime(window.durationSeconds);
      this.consecutiveEmptyFromSameCursor = 0;
      this.lastMatureCursor = window.durationSeconds;
    } else {
      // Advance the window builder's mature cursor
      this.windowBuilder.advanceMatureCursorByTime(mergerResult.matureCursorTime);
    }

    // Emit partial result
    this.callbacks.onPartial({
      matureText: mergerResult.matureText,
      pendingText: mergerResult.immatureText,
      fullText: mergerResult.fullText,
    });
  }
}
