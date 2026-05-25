/**
 * Shared WindowBuilder — cursor-based dynamic window construction for streaming transcription.
 *
 * Ported from keet's src/lib/transcription/WindowBuilder.ts.
 *
 * Instead of fixed-period windows, this builder creates windows that:
 *   - Start at the mature cursor (end of last finalized sentence)
 *   - Extend to the current audio position
 *   - Respect min/max duration constraints
 *   - Optionally use VAD data to align boundaries to silence
 *   - Never re-transcribe audio before the mature cursor
 *
 * Depends on abstract IRingBuffer and IVAD interfaces — platform-independent.
 */
import type { IRingBuffer, IVAD, WindowBuilderConfig } from "./types.js";
import { DEFAULT_WINDOW_BUILDER_CONFIG } from "./types.js";

/** A constructed transcription window. */
export interface TranscriptionWindow {
  /** Start frame in global offset. */
  startFrame: number;
  /** End frame in global offset. */
  endFrame: number;
  /** Duration of the window in seconds. */
  durationSeconds: number;
  /** Whether this is an initial (pre-first-sentence) window. */
  isInitial: boolean;
}

export class WindowBuilder {
  private config: WindowBuilderConfig;
  private ringBuffer: IRingBuffer;
  private vad: IVAD;

  // State
  private sentenceEnds: number[] = [];
  private matureCursorFrame: number = 0;
  private firstSentenceReceived: boolean = false;

  constructor(
    ringBuffer: IRingBuffer,
    vad: IVAD,
    config: Partial<WindowBuilderConfig> = {},
  ) {
    this.ringBuffer = ringBuffer;
    this.vad = vad;
    this.config = { ...DEFAULT_WINDOW_BUILDER_CONFIG, ...config };
  }

  /**
   * Record the end frame of a finalized sentence.
   */
  markSentenceEnd(frameIdx: number): void {
    this.sentenceEnds.push(frameIdx);
    if (this.sentenceEnds.length > 4) {
      this.sentenceEnds = this.sentenceEnds.slice(-4);
    }
    if (!this.firstSentenceReceived) {
      this.firstSentenceReceived = true;
    }
  }

  /**
   * Advance the mature cursor to a time (seconds).
   */
  advanceMatureCursorByTime(timeSec: number): void {
    const frameIdx = Math.round(timeSec * this.config.sampleRate);
    if (frameIdx > this.matureCursorFrame) {
      this.matureCursorFrame = frameIdx;
      if (!this.firstSentenceReceived) {
        this.firstSentenceReceived = true;
      }
    }
  }

  getMatureCursorFrame(): number {
    return this.matureCursorFrame;
  }

  getMatureCursorTime(): number {
    return this.matureCursorFrame / this.config.sampleRate;
  }

  /**
   * Build a transcription window from the mature cursor to the current buffer head.
   * Returns null if insufficient audio is available.
   */
  buildWindow(): TranscriptionWindow | null {
    const endFrame = this.ringBuffer.getCurrentFrame();
    const baseFrame = this.ringBuffer.getBaseFrameOffset();

    if (endFrame === baseFrame) {
      return null; // no data
    }

    const availableFrames = endFrame - baseFrame;
    const availableSec = availableFrames / this.config.sampleRate;

    // ── Initial mode (before first sentence) ──
    if (!this.firstSentenceReceived) {
      const minInitialFrames = Math.round(
        this.config.minInitialDurationSec * this.config.sampleRate,
      );
      if (availableFrames < minInitialFrames) {
        if (this.config.debug && availableFrames > 0 && availableFrames % (this.config.sampleRate * 2) < 4096) {
          console.debug("[WindowBuilder] waiting for initial audio:", availableSec.toFixed(1), "s /", this.config.minInitialDurationSec.toFixed(1), "s");
        }
        return null;
      }

      const maxFrames = Math.round(this.config.maxDurationSec * this.config.sampleRate);
      const clippedEnd = Math.min(endFrame, baseFrame + maxFrames);
      const duration = (clippedEnd - baseFrame) / this.config.sampleRate;

      if (this.config.debug) {
        console.debug("[WindowBuilder] initial window built:", duration.toFixed(2), "s");
      }

      return {
        startFrame: baseFrame,
        endFrame: clippedEnd,
        durationSeconds: duration,
        isInitial: true,
      };
    }

    // ── Normal mode (after first sentence) ──
    let startFrame = this.matureCursorFrame;
    if (startFrame < baseFrame) {
      startFrame = baseFrame;
    }

    if (startFrame >= endFrame) {
      return null;
    }

    let windowFrames = endFrame - startFrame;

    // Enforce minimum duration
    const minFrames = Math.round(this.config.minDurationSec * this.config.sampleRate);
    if (windowFrames < minFrames) {
      return null;
    }

    // Enforce maximum duration (trim from start, never go before mature cursor)
    const maxFrames = Math.round(this.config.maxDurationSec * this.config.sampleRate);
    if (windowFrames > maxFrames) {
      const proposedStart = endFrame - maxFrames;
      startFrame = Math.max(this.matureCursorFrame, proposedStart);
      windowFrames = endFrame - startFrame;
    }

    // VAD boundary refinement: nudge start to nearest silence
    if (this.config.useVadBoundaries) {
      const searchEnd = Math.min(
        startFrame + Math.round(this.config.sampleRate * 0.5),
        endFrame,
      );
      const vadStart = this.findSilenceBoundary(searchEnd, startFrame);
      if (vadStart > startFrame) {
        const newDuration = (endFrame - vadStart) / this.config.sampleRate;
        if (newDuration >= this.config.minDurationSec) {
          startFrame = vadStart;
          windowFrames = endFrame - vadStart;
        }
      }
    }

    if (startFrame >= endFrame) {
      return null;
    }

    const durationSeconds = windowFrames / this.config.sampleRate;

    if (this.config.debug) {
      console.debug("[WindowBuilder] window built:", durationSeconds.toFixed(2), "s", "(mature:", (this.matureCursorFrame / this.config.sampleRate).toFixed(2), "s)");
    }

    return {
      startFrame,
      endFrame,
      durationSeconds,
      isInitial: false,
    };
  }

  /**
   * Reset all internal state.
   */
  reset(): void {
    this.sentenceEnds = [];
    this.matureCursorFrame = 0;
    this.firstSentenceReceived = false;
  }

  /**
   * Find the nearest silence boundary scanning backward from searchEnd.
   * Returns the frame where silence begins, or startFrame if none found.
   */
  private findSilenceBoundary(searchEnd: number, startFrame: number): number {
    // Simplified: we can't replay audio through the VAD, so we approximate
    // by checking if VAD is currently silent. If the VAD is in speech state,
    // we don't nudge the boundary (we'd be cutting into speech).
    if (this.vad.isSpeechActive()) {
      return startFrame;
    }
    // VAD says silence — nudge forward to the search end (latest silence)
    return searchEnd;
  }
}
