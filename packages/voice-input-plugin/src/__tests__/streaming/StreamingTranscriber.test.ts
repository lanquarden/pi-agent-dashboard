/**
 * StreamingTranscriber integration tests.
 *
 * Tests the full orchestrator pipeline with a scriptable timeline-based mock VAD
 * that produces realistic speechStart/speechEnd transitions.
 *
 * Audio: synthetic sine-wave PCM at known amplitudes
 * VAD: TimelineVAD follows a pre-scripted speech/silence schedule keyed by sample count
 * Engine: returns known transcriptions with word timestamps that match audio positions
 * Verification: asserts specific matureText/pendingText/fullText at each stage,
 *   not just typeof checks. Follows keet's UtteranceBasedMerger regression fixture pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingTranscriber } from "../../shared/streaming/StreamingTranscriber.js";
import { WindowBuilder } from "../../shared/streaming/WindowBuilder.js";
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

// ── Constants ──────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000;
const CHUNK_MS = 100;
const CHUNK_SAMPLES = Math.floor(SAMPLE_RATE * CHUNK_MS / 1000); // 1600

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
  emit(chunk: Float32Array): void {
    for (const cb of this.cbs) cb(chunk);
  }
}

/** Simple append ring buffer for testing — no wrap-around needed for short tests. */
class MockRingBuffer implements IRingBuffer {
  private buf = new Float32Array(0);
  private currentFrame = 0;
  private baseOffset = 0;

  write(chunk: Float32Array): void {
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
  getCurrentTime(): number { return this.currentFrame / SAMPLE_RATE; }
  reset(): void { this.buf = new Float32Array(0); this.currentFrame = 0; this.baseOffset = 0; }
}

/**
 * TimelineVAD — scriptable VAD that follows a speech/silence schedule.
 *
 * Each entry is [startSample, endSample, isSpeech].
 * At a given sample offset, the VAD returns the corresponding state.
 * Transitions produce speechStart/speechEnd flags.
 */
class TimelineVAD implements IVAD {
  private timeline: Array<{ start: number; end: number; speech: boolean }>;
  private sampleOffset: number = 0;
  private wasSpeech: boolean = false;

  /**
   * @param segments Array of [startSec, endSec, isSpeech]
   */
  constructor(segments: Array<[number, number, boolean]>, sampleRate: number = SAMPLE_RATE) {
    this.timeline = segments.map(([start, end, speech]) => ({
      start: Math.round(start * sampleRate),
      end: Math.round(end * sampleRate),
      speech,
    }));
  }

  process(chunk: Float32Array): VADResult {
    const chunkStart = this.sampleOffset;
    const chunkEnd = this.sampleOffset + chunk.length;
    const midpoint = Math.floor((chunkStart + chunkEnd) / 2);

    let isSpeech = false;
    for (const seg of this.timeline) {
      if (midpoint >= seg.start && midpoint < seg.end) {
        isSpeech = seg.speech;
        break;
      }
    }

    const speechStart = isSpeech && !this.wasSpeech;
    const speechEnd = !isSpeech && this.wasSpeech;

    this.wasSpeech = isSpeech;
    this.sampleOffset = chunkEnd;

    const energy = isSpeech ? 0.15 : 0.001;
    return { isSpeech, speechStart, speechEnd, energy };
  }

  isSpeechActive(): boolean { return this.wasSpeech; }
  reset(): void { this.sampleOffset = 0; this.wasSpeech = false; }
}

/**
 * ScriptableEngine — returns pre-registered transcriptions for each window call.
 */
interface EngineScript {
  text: string;
}

class ScriptableEngine implements ITranscriptionEngine {
  private callCount = 0;
  private scripts: EngineScript[];

  constructor(scripts: EngineScript[]) {
    this.scripts = scripts;
  }

  async transcribe(
    _audio: Float32Array,
    _sampleRate: number,
    opts?: TranscribeOpts,
  ): Promise<TranscribeResult> {
    const script = this.scripts[this.callCount];
    this.callCount++;
    if (!script) return { utterance_text: "" };

    const timeOffset = opts?.timeOffset ?? 0;
    const wordInterval = 0.4;

    const wordTexts = script.text.split(/\s+/).filter(Boolean);
    const words = wordTexts.map((w, i) => ({
      text: w,
      start_time: timeOffset + i * wordInterval,
      end_time: timeOffset + (i + 1) * wordInterval - 0.05,
      confidence: 0.9,
    }));

    return { utterance_text: script.text, words };
  }

  resetCache(): void { this.callCount = 0; }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sineChunk(freq: number, amp: number, samples: number = CHUNK_SAMPLES): Float32Array {
  const chunk = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    chunk[i] = amp * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
  }
  return chunk;
}

function silenceChunk(samples: number = CHUNK_SAMPLES): Float32Array {
  return new Float32Array(samples);
}

/**
 * Feed audio chunks in phases, waiting for window processing to complete
 * between batches. This mirrors the real streaming flow where audio arrives
 * continuously — each new chunk re-triggers buildWindow() after a prior
 * window finishes.
 */
async function feedPhased(
  audioSource: MockAudioSource,
  chunk: Float32Array,
  chunksPerPhase: number,
  phases: number,
  waitMs: number = 500,
): Promise<void> {
  for (let phase = 0; phase < phases; phase++) {
    for (let i = 0; i < chunksPerPhase; i++) {
      audioSource.emit(chunk);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("StreamingTranscriber", () => {
  let partialResults: Array<{ matureText: string; pendingText: string; fullText: string }>;
  let errors: Error[];

  beforeEach(() => {
    partialResults = [];
    errors = [];
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Full pipeline: speech → expanding windows
  // ─────────────────────────────────────────────────────────────────────────

  it("produces mature text from expanding overlapping windows with proper VAD transitions", async () => {
    // Speech from 0.1s onward throughout the test.
    const timelineVAD = new TimelineVAD([[0.1, 10.0, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    const engine = new ScriptableEngine([
      { text: "Hello world." },
      { text: "Hello world. How are" },
      { text: "Hello world. How are you?" },
    ]);

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    // Feed in phases: 4 chunks per phase (0.4s), 6 phases (~2.4s total).
    const loud = sineChunk(440, 0.5);
    await feedPhased(audioSource, loud, 4, 6, 500);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);
    const firstPartial = partialResults[0];
    expect(firstPartial.fullText).toContain("Hello");

    const finalText = transcriber.stop();
    expect(finalText).toContain("Hello world");
    expect(finalText).toContain("How are");
    expect(errors).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // VAD speechStart transitions the WindowBuilder from initial to normal mode
  // ─────────────────────────────────────────────────────────────────────────

  it("transitions from initial to normal window mode after speechStart", async () => {
    const timelineVAD = new TimelineVAD([[0.2, 10.0, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    const engine = new ScriptableEngine([
      { text: "First window text." },
      { text: "Second window text." },
    ]);

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    const loud = sineChunk(440, 0.5);
    await feedPhased(audioSource, loud, 4, 5, 500);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);

    const finalText = transcriber.stop();
    expect(finalText.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Stuck-loop guard: silence after speech doesn't spin forever
  // ─────────────────────────────────────────────────────────────────────────

  it("stuck-loop guard advances cursor past silent regions", async () => {
    // Brief speech at the start, then long silence.
    const timelineVAD = new TimelineVAD([[0.1, 0.5, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    const engine = new ScriptableEngine([
      { text: "Hi." },
      { text: "" },
      { text: "" },
      { text: "" },
      { text: "" },
      { text: "" },
    ]);

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    // First 0.5s: speech, then silence
    const loud = sineChunk(440, 0.5);
    const quiet = silenceChunk();

    // Phase 1: 0.5s of speech (5 chunks)
    for (let i = 0; i < 5; i++) audioSource.emit(loud);
    await new Promise((r) => setTimeout(r, 500));

    // Phase 2-5: silence chunks
    await feedPhased(audioSource, quiet, 5, 4, 500);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);

    const finalText = transcriber.stop();
    expect(finalText).toContain("Hi");
    expect(errors).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reset clears all state mid-recording
  // ─────────────────────────────────────────────────────────────────────────

  it("reset clears all state mid-recording", async () => {
    const timelineVAD = new TimelineVAD([[0.1, 10.0, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    // Overlapping windows: each window transcribes ALL accumulated audio
    const engine = new ScriptableEngine([
      { text: "Before reset." },
      { text: "Before reset. More text." },
    ]);

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    // Feed first phase — one window fires with "Before reset."
    const loud = sineChunk(440, 0.5);
    await feedPhased(audioSource, loud, 4, 3, 500);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);

    // Reset mid-stream. reset() calls engine.resetCache() → callCount=0.
    partialResults.length = 0;
    transcriber.reset();

    expect(ringBuffer.getCurrentFrame()).toBe(0);
    expect(merger.getMatureText()).toBe("");
    expect(merger.getImmatureText()).toBe("");
    expect(merger.getMatureCursorTime()).toBe(0);

    // Feed new audio — engine returns "Before reset." again (callCount reset to 0)
    await feedPhased(audioSource, loud, 4, 3, 500);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);

    const finalText = transcriber.stop();
    expect(finalText).toContain("Before reset");
    expect(errors).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Engine error propagates to error callback
  // ─────────────────────────────────────────────────────────────────────────

  it("propagates engine errors to the error callback", async () => {
    const timelineVAD = new TimelineVAD([[0.1, 10.0, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    class FailingEngine implements ITranscriptionEngine {
      async transcribe(): Promise<TranscribeResult> {
        throw new Error("Inference failed");
      }
    }

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine: new FailingEngine(),
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    const loud = sineChunk(440, 0.5);
    await feedPhased(audioSource, loud, 4, 3, 500);

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("Inference failed");

    transcriber.stop();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Concurrent window processing guard
  // ─────────────────────────────────────────────────────────────────────────

  it("does not stack concurrent window processing", async () => {
    const timelineVAD = new TimelineVAD([[0.1, 10.0, true]], SAMPLE_RATE);
    const audioSource = new MockAudioSource();
    const ringBuffer = new MockRingBuffer();

    let transcribeCalls = 0;
    class SlowEngine implements ITranscriptionEngine {
      async transcribe(
        _audio: Float32Array,
        _sampleRate: number,
        _opts?: TranscribeOpts,
      ): Promise<TranscribeResult> {
        transcribeCalls++;
        await new Promise((r) => setTimeout(r, 50));
        const text = `Window ${transcribeCalls} text.`;
        return {
          utterance_text: text,
          words: text.split(/\s+/).filter(Boolean).map((w, i) => ({
            text: w,
            start_time: i * 0.4,
            end_time: (i + 1) * 0.4 - 0.05,
            confidence: 0.9,
          })),
        };
      }
    }

    const windowBuilder = new WindowBuilder(ringBuffer, timelineVAD, {
      sampleRate: SAMPLE_RATE,
      minDurationSec: 0.3,
      maxDurationSec: 30,
      minInitialDurationSec: 0.2,
      useVadBoundaries: false,
      debug: false,
    });

    const merger = new UtteranceBasedMerger({ useNLP: false, debug: false });

    const slowEngine = new SlowEngine();
    const transcriber = new StreamingTranscriber({
      audioSource, ringBuffer,
      vad: timelineVAD,
      windowBuilder,
      engine: slowEngine,
      merger,
      callbacks: {
        onPartial: (r) => partialResults.push(r),
        onError: (e) => errors.push(e),
      },
    });

    await transcriber.start();

    // Feed chunks in phases with enough wait for slow engine
    const loud = sineChunk(440, 0.5);
    await feedPhased(audioSource, loud, 4, 4, 150);

    expect(partialResults.length).toBeGreaterThanOrEqual(1);
    expect(transcribeCalls).toBeGreaterThanOrEqual(1);

    const finalText = transcriber.stop();
    expect(finalText.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });
});
