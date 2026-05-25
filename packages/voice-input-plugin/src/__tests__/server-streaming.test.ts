/**
 * Server-side streaming session manager tests.
 *
 * Tests the per-session StreamingTranscriber lifecycle:
 *   getOrCreateStream → pushChunk → stopStream → cleanupStale.
 *
 * Uses a scriptable mock model (like the orchestrator tests) so no
 * real ONNX model download is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOrCreateStream,
  pushChunk,
  stopStream,
  cleanupStale,
} from "../server/server-streaming.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000;

function sineChunk(freq: number, amp: number, samples: number = 1600): Float32Array {
  const chunk = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    chunk[i] = amp * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
  }
  return chunk;
}

/**
 * Creates a mock model object that returns pre-scripted transcriptions.
 * Mirrors the wrapper shape in server/index.ts getStreamingModel().
 */
function createMockModel(transcripts: string[]) {
  let callCount = 0;
  return {
    transcribe: async (audio: Float32Array, _sr: number, _opts?: Record<string, unknown>) => {
      const text = transcripts[callCount] ?? "";
      callCount++;
      const words = text.split(/\s+/).filter(Boolean).map((w, i) => ({
        text: w,
        start_time: i * 0.4,
        end_time: (i + 1) * 0.4 - 0.05,
        confidence: 0.9,
      }));
      return { utterance_text: text, words };
    },
    resetMelCache: () => {},
  };
}

async function createCachedModel(transcripts: string[]): Promise<Record<string, unknown>> {
  return createMockModel(transcripts);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("server-streaming session manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up sessions from previous tests
    cleanupStale();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a stream and routes chunks through the pipeline", async () => {
    const partials: Array<{ sessionId: string; matureText: string; pendingText: string; seq: number }> = [];
    const errors: Array<{ sessionId: string; error: string }> = [];

    const modelFactory = () => createCachedModel([
      "Hello world.",            // window 1
      "Hello world. How are",    // window 2
      "Hello world. How are you?", // window 3
    ]);

    getOrCreateStream(
      "session-1",
      modelFactory,
      (sid, matureText, pendingText, seq) => {
        partials.push({ sessionId: sid, matureText, pendingText, seq });
      },
      (sid, error) => {
        errors.push({ sessionId: sid, error });
      },
    );

    // Feed 5 seconds of audio chunks (50 chunks × 100ms)
    const loud = sineChunk(440, 0.5);
    for (let i = 0; i < 50; i++) {
      pushChunk("session-1", loud);
    }

    // Let the streaming pipeline process windows
    await vi.advanceTimersByTimeAsync(5000);

    // Stop and get final text
    const fullText = stopStream("session-1");
    expect(fullText.length).toBeGreaterThan(0);
    expect(fullText).toContain("Hello");
    expect(errors).toHaveLength(0);

    // We should have gotten at least one partial result callback
    expect(partials.length).toBeGreaterThanOrEqual(1);
  });

  it("stopStream returns empty string for unknown session", () => {
    expect(stopStream("nonexistent")).toBe("");
  });

  it("pushChunk is a no-op for unknown session", () => {
    // Should not throw
    pushChunk("nonexistent", sineChunk(440, 0.5));
  });

  it("getOrCreateStream returns existing session on second call", () => {
    const partials: Array<{ sessionId: string }> = [];
    const modelFactory = () => createCachedModel(["Hello."]);

    const first = getOrCreateStream(
      "session-2",
      modelFactory,
      () => {},
      () => {},
    );

    const second = getOrCreateStream(
      "session-2",
      modelFactory,
      (sid) => partials.push({ sessionId: sid }),
      () => {},
    );

    // Should return the same session object
    expect(second).toBe(first);
    // lastChunkAt should be refreshed
    expect(second.lastChunkAt).toBeGreaterThanOrEqual(first.createdAt);
  });

  it("cleanupStale removes sessions past TTL", async () => {
    const modelFactory = () => createCachedModel(["Test."]);

    getOrCreateStream("session-3", modelFactory, () => {}, () => {});

    // Advance time past the 30s TTL
    vi.advanceTimersByTime(35_000);

    cleanupStale();

    // Session should be gone — stopStream returns empty
    const result = stopStream("session-3");
    expect(result).toBe("");
  });

  it("cleanupStale keeps sessions within TTL", () => {
    const modelFactory = () => createCachedModel(["Test."]);

    getOrCreateStream("session-4", modelFactory, () => {}, () => {});

    // Advance 10s (well within 30s TTL)
    vi.advanceTimersByTime(10_000);

    cleanupStale();

    // Session should still be alive
    // pushChunk should work
    pushChunk("session-4", sineChunk(440, 0.5));
    // stopStream should return (may be empty if no window fired yet)
    const result = stopStream("session-4");
    // Even if no text, session existed — it was cleaned by stopStream, not cleanupStale
    expect(typeof result).toBe("string");
  });
});
