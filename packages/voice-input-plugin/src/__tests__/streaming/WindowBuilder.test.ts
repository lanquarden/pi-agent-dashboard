/**
 * WindowBuilder tests — ported from keet's src/lib/transcription/WindowBuilder.test.ts.
 *
 * Tests cursor-based dynamic window construction: initial mode, mature cursor
 * advancement, min/max duration constraints, VAD integration, and reset.
 */
import { describe, it, expect } from "vitest";
import { WindowBuilder } from "../../shared/streaming/WindowBuilder.js";
import { EnergyVAD } from "../../shared/streaming/EnergyVAD.js";
import type { IRingBuffer, VADResult } from "../../shared/streaming/types.js";

const SAMPLE_RATE = 16000;

// ── Mock ring buffer ──────────────────────────────────────────────────────

function createMockRingBuffer(
  baseFrame: number,
  currentFrame: number,
): IRingBuffer {
  return {
    write: () => {},
    read: () => new Float32Array(0),
    getCurrentFrame: () => currentFrame,
    getBaseFrameOffset: () => baseFrame,
    getCurrentTime: () => currentFrame / SAMPLE_RATE,
    reset: () => {},
  };
}

function createMutableMockRingBuffer(
  baseFrame: number,
  currentFrameRef: { value: number },
): IRingBuffer {
  return {
    write: () => {},
    read: () => new Float32Array(0),
    getCurrentFrame: () => currentFrameRef.value,
    getBaseFrameOffset: () => baseFrame,
    getCurrentTime: () => currentFrameRef.value / SAMPLE_RATE,
    reset: () => {},
  };
}

// ── Mock VAD (for VAD boundary refinement tests) ──────────────────────────

class MockVAD {
  private speechActive = false;
  process(_chunk: Float32Array): VADResult {
    return { isSpeech: this.speechActive, speechStart: false, speechEnd: false, energy: 0 };
  }
  isSpeechActive(): boolean { return this.speechActive; }
  setSpeech(v: boolean) { this.speechActive = v; }
  reset() { this.speechActive = false; }
}

describe("WindowBuilder", () => {
  // ── Initial mode (before first sentence) ────────────────────────────────

  describe("initial mode", () => {
    it("returns null when not enough audio for minInitialDurationSec", () => {
      const ring = createMockRingBuffer(0, Math.floor(SAMPLE_RATE * 0.5));
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        minInitialDurationSec: 1.5,
      });
      expect(builder.buildWindow()).toBeNull();
    });

    it("returns initial window when enough audio", () => {
      const ring = createMockRingBuffer(0, Math.floor(SAMPLE_RATE * 2));
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        minInitialDurationSec: 1.5,
      });
      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      expect(win!.isInitial).toBe(true);
      expect(win!.startFrame).toBe(0);
      expect(win!.durationSeconds).toBeGreaterThanOrEqual(1.5);
    });

    it("clamps initial window to maxDuration", () => {
      const ring = createMockRingBuffer(0, Math.floor(SAMPLE_RATE * 35));
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        minInitialDurationSec: 1.5,
      });
      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      expect(win!.durationSeconds).toBeLessThanOrEqual(30);
    });
  });

  // ── Mature cursor and sentence bookkeeping ─────────────────────────────

  describe("mature cursor", () => {
    it("advances mature cursor and reports position", () => {
      const ring = createMockRingBuffer(0, Math.floor(SAMPLE_RATE * 5));
      const builder = new WindowBuilder(ring, new MockVAD(), { sampleRate: SAMPLE_RATE });
      expect(builder.getMatureCursorFrame()).toBe(0);

      builder.advanceMatureCursorByTime(2);
      expect(builder.getMatureCursorFrame()).toBe(SAMPLE_RATE * 2);
      expect(builder.getMatureCursorTime()).toBe(2);
    });

    it("marks first sentence received on cursor advance", () => {
      const ring = createMockRingBuffer(0, Math.floor(SAMPLE_RATE * 5));
      const builder = new WindowBuilder(ring, new MockVAD(), { sampleRate: SAMPLE_RATE });

      // Before first sentence: should build initial windows
      builder.advanceMatureCursorByTime(2);
      // After this, firstSentenceReceived = true, so subsequent windows
      // should be in "normal" mode (start at cursor, not base)
      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      expect(win!.isInitial).toBe(false);
      expect(win!.startFrame).toBe(SAMPLE_RATE * 2);
    });
  });

  // ── Normal mode (after first sentence) ─────────────────────────────────

  describe("normal mode", () => {
    it("returns null when start >= end (no new audio since cursor)", () => {
      const ring = createMockRingBuffer(0, SAMPLE_RATE);
      const builder = new WindowBuilder(ring, new MockVAD(), { sampleRate: SAMPLE_RATE });
      builder.markSentenceEnd(SAMPLE_RATE);
      builder.advanceMatureCursorByTime(1);
      // cursor at 16000, end at 16000 → start >= end
      expect(builder.buildWindow()).toBeNull();
    });

    it("enforces min duration and returns null when insufficient", () => {
      // Cursor at 1s, total audio 3s → 2s window, but minDuration is 3s
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 3);
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
      });
      builder.markSentenceEnd(SAMPLE_RATE);
      builder.advanceMatureCursorByTime(1);
      const win = builder.buildWindow();
      expect(win).toBeNull();
    });

    it("keeps window start anchored to mature cursor while head grows", () => {
      const frameRef = { value: SAMPLE_RATE * 10 };
      const ring = createMutableMockRingBuffer(0, frameRef);
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        useVadBoundaries: false,
      });
      builder.markSentenceEnd(SAMPLE_RATE * 2);
      builder.advanceMatureCursorByTime(2);

      const first = builder.buildWindow();
      expect(first).not.toBeNull();
      expect(first!.startFrame).toBe(SAMPLE_RATE * 2);
      expect(first!.endFrame).toBe(SAMPLE_RATE * 10);

      // Head advances — window should expand, cursor stays anchored
      frameRef.value = SAMPLE_RATE * 12;
      const second = builder.buildWindow();
      expect(second).not.toBeNull();
      expect(second!.startFrame).toBe(SAMPLE_RATE * 2);
      expect(second!.endFrame).toBe(SAMPLE_RATE * 12);
    });

    it("clamps window to maxDuration", () => {
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 40);
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 10,
      });
      builder.advanceMatureCursorByTime(1);

      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      expect(win!.durationSeconds).toBeLessThanOrEqual(10);
      // Start should be at most maxDuration before end
      expect(win!.startFrame).toBeGreaterThanOrEqual(win!.endFrame - SAMPLE_RATE * 10);
    });

    it("never recedes start before mature cursor when clamping", () => {
      // Cursor at 5s, total audio 38s → window should be 5s→38s, but max 10s → 5s→15s (start stays at cursor)
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 38);
      const builder = new WindowBuilder(ring, new MockVAD(), {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 10,
      });
      builder.advanceMatureCursorByTime(5);

      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      // Start must not go before cursor (5s)
      expect(win!.startFrame).toBeGreaterThanOrEqual(SAMPLE_RATE * 5);
    });
  });

  // ── VAD integration ────────────────────────────────────────────────────

  describe("VAD boundary refinement", () => {
    it("nudges start forward when VAD reports silence", () => {
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 10);
      const vad = new MockVAD();
      vad.setSpeech(false); // currently silent

      const builder = new WindowBuilder(ring, vad, {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        useVadBoundaries: true,
      });
      builder.advanceMatureCursorByTime(2);

      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      // Start should have been nudged forward (but not past end)
      expect(win!.startFrame).toBeGreaterThanOrEqual(SAMPLE_RATE * 2);
    });

    it("does not nudge during speech to avoid cutting into words", () => {
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 10);
      const vad = new MockVAD();
      vad.setSpeech(true); // currently speaking

      const builder = new WindowBuilder(ring, vad, {
        sampleRate: SAMPLE_RATE,
        minDurationSec: 3,
        maxDurationSec: 30,
        useVadBoundaries: true,
      });
      builder.advanceMatureCursorByTime(2);

      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      // Start should remain at cursor (not nudged) because VAD says speech
      expect(win!.startFrame).toBe(SAMPLE_RATE * 2);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears sentence ends and mature cursor", () => {
      const ring = createMockRingBuffer(0, SAMPLE_RATE * 5);
      const builder = new WindowBuilder(ring, new MockVAD(), { sampleRate: SAMPLE_RATE });
      builder.markSentenceEnd(1000);
      builder.advanceMatureCursorByTime(1);

      builder.reset();

      expect(builder.getMatureCursorFrame()).toBe(0);
      // After reset, should be back in initial mode
      const win = builder.buildWindow();
      expect(win).not.toBeNull();
      expect(win!.isInitial).toBe(true);
    });
  });
});
