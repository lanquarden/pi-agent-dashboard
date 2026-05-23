/**
 * StreamingTranscriber integration test.
 *
 * Tests the full orchestrator pipeline with mock adapters:
 * audio source → ring buffer → VAD → window builder → engine → merger → callbacks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingTranscriber } from "../../shared/streaming/StreamingTranscriber.js";
import { WindowBuilder } from "../../shared/streaming/WindowBuilder.js";
import { EnergyVAD } from "../../shared/streaming/EnergyVAD.js";
import { UtteranceBasedMerger } from "../../shared/streaming/UtteranceBasedMerger.js";
import type {
  IAudioSource,
  IRingBuffer,
  IVAD,
  ITranscriptionEngine,
  TranscribeOpts,
  TranscribeResult,
  VADResult,
} from "../../shared/streaming/types.js";

// ── Mock adapters ──────────────────────────────────────────────────────────

class MockAudioSource implements IAudioSource {
  private cbs: Array<(chunk: Float32Array) => void> = [];
  private active = false;

  onChunk(cb: (chunk: Float32Array) => void): () => void {
    this.cbs.push(cb);
    return () => { this.cbs = this.cbs.filter((c) => c !== cb); };
  }
  async start(): Promise<void> { this.active = true; }
  stop(): void { this.active = false; }
  isActive(): boolean { return this.active; }
  /** Simulate an audio chunk arriving. */
  emit(chunk: Float32Array): void {
    for (const cb of this.cbs) cb(chunk);
  }
}

class MockRingBuffer implements IRingBuffer {
  private buf = new Float32Array(0);
  private currentFrame = 0;
  private baseOffset = 0;

  write(chunk: Float32Array): void {
    // Simple append for testing — no wrap-around
    const newBuf = new Float32Array(this.buf.length + chunk.length);
    newBuf.set(this.buf);
    newBuf.set(chunk, this.buf.length);
    this.buf = newBuf;
    this.currentFrame += chunk.length;
  }
  read(startFrame: number, endFrame: number): Float32Array {
    return this.buf.slice(startFrame, endFrame);
  }
  getCurrentFrame(): number { return this.currentFrame; }
  getBaseFrameOffset(): number { return this.baseOffset; }
  getCurrentTime(): number { return this.currentFrame / 16000; }
  reset(): void { this.buf = new Float32Array(0); this.currentFrame = 0; this.baseOffset = 0; }
}

class MockVAD implements IVAD {
  process(_c: Float32Array): VADResult {
    return { isSpeech: true, speechStart: false, speechEnd: false, energy: 0.1 };
  }
  isSpeechActive(): boolean { return true; }
  reset(): void {}
}

class MockEngine implements ITranscriptionEngine {
  private callCount = 0;
  private results: string[] = [];

  constructor(results: string[]) {
    this.results = results;
  }

  async transcribe(
    _audio: Float32Array,
    _sampleRate: number,
    _opts?: TranscribeOpts,
  ): Promise<TranscribeResult> {
    const text = this.results[this.callCount] ?? "";
    this.callCount++;

    // Generate synthetic words from the text
    const words = text.split(/\s+/).filter(Boolean).map((w, i) => ({
      text: w,
      start_time: i * 0.5,
      end_time: (i + 1) * 0.5,
      confidence: 0.9,
    }));

    return { utterance_text: text, words };
  }

  resetCache(): void { this.callCount = 0; }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("StreamingTranscriber", () => {
  let audioSource: MockAudioSource;
  let ringBuffer: MockRingBuffer;
  let vad: MockVAD;
  let engine: MockEngine;
  let windowBuilder: WindowBuilder;
  let merger: UtteranceBasedMerger;
  let partialResults: Array<{ matureText: string; pendingText: string; fullText: string }>;

  beforeEach(() => {
    audioSource = new MockAudioSource();
    ringBuffer = new MockRingBuffer();
    vad = new MockVAD();

    // Use mock engine with known transcriptions
    engine = new MockEngine([
      "Hello world.",                        // first window
      "Hello world. How are",               // second window (overlapping)
      "Hello world. How are you?",          // third window
    ]);

    windowBuilder = new WindowBuilder(ringBuffer, vad, {
      sampleRate: 16000,
      minDurationSec: 0.1,     // Very low for test speed
      maxDurationSec: 30,
      minInitialDurationSec: 0.05,
      useVadBoundaries: false, // Disable VAD refinement for deterministic tests
      debug: false,
    });

    merger = new UtteranceBasedMerger({ useNLP: false, debug: false });
    partialResults = [];
  });

  it("runs full pipeline and emits partial results", async () => {
    const transcriber = new StreamingTranscriber({
      audioSource,
      ringBuffer,
      vad,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
      },
    });

    await transcriber.start();

    // Simulate audio chunks arriving — ~1 second of 16kHz audio
    const chunk = new Float32Array(1600); // 100ms
    for (let i = 0; i < 10; i++) {
      audioSource.emit(chunk);
    }

    // Wait for async transcription to complete
    await vi.waitFor(
      () => {
        expect(partialResults.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    // Stop and get final text
    const finalText = transcriber.stop();

    // Should have produced some text
    expect(finalText.length).toBeGreaterThan(0);

    // Partial results should show text progression
    for (const pr of partialResults) {
      expect(typeof pr.matureText).toBe("string");
      expect(typeof pr.pendingText).toBe("string");
      expect(typeof pr.fullText).toBe("string");
    }
  });

  it("reset clears all state", async () => {
    const transcriber = new StreamingTranscriber({
      audioSource,
      ringBuffer,
      vad,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
      },
    });

    await transcriber.start();
    audioSource.emit(new Float32Array(16000)); // 1 second of audio

    await vi.waitFor(
      () => {
        expect(partialResults.length).toBeGreaterThan(0);
      },
      { timeout: 2000 },
    );

    // Reset and verify clean state
    partialResults.length = 0;
    transcriber.reset();

    expect(ringBuffer.getCurrentFrame()).toBe(0);
    expect(merger.getMatureText()).toBe("");
    expect(merger.getImmatureText()).toBe("");
  });
});
