/**
 * EnergyVAD tests — ported from keet's src/lib/vad/EnergyVAD.test.ts.
 *
 * Tests the SNR-based state machine: speech detection, hysteresis,
 * noise floor adaptation, reset, and config updates.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EnergyVAD } from "../../shared/streaming/EnergyVAD.js";

describe("EnergyVAD", () => {
  let vad: EnergyVAD;
  const SAMPLE_RATE = 16000;
  const CHUNK_SIZE = 160; // 10ms at 16kHz

  const createChunk = (length: number, amplitude: number): Float32Array => {
    const chunk = new Float32Array(length);
    chunk.fill(amplitude);
    return chunk;
  };

  beforeEach(() => {
    vad = new EnergyVAD({
      sampleRate: SAMPLE_RATE,
      minSpeechDuration: 100,
      minSilenceDuration: 300,
      energyThreshold: 0.02,
    });
  });

  it("initializes with correct default state", () => {
    // First process call should be silence with no transitions
    const result = vad.process(createChunk(CHUNK_SIZE, 0));
    expect(result.isSpeech).toBe(false);
    expect(result.speechStart).toBe(false);
    expect(result.speechEnd).toBe(false);
  });

  it("detects speech after minSpeechDuration", () => {
    const loudChunk = createChunk(CHUNK_SIZE, 0.1); // Energy 0.1 > 0.02

    // Feed 9 chunks (90ms) — should still be silent
    for (let i = 0; i < 9; i++) {
      const result = vad.process(loudChunk);
      expect(result.isSpeech).toBe(false);
      expect(result.speechStart).toBe(false);
    }

    // 10th chunk (100ms total) — should trigger speech
    const triggerResult = vad.process(loudChunk);
    expect(triggerResult.isSpeech).toBe(true);
    expect(triggerResult.speechStart).toBe(true);

    // 11th chunk — should stay in speech, no new start
    const nextResult = vad.process(loudChunk);
    expect(nextResult.isSpeech).toBe(true);
    expect(nextResult.speechStart).toBe(false);
  });

  it("handles hysteresis — ignores short silence gaps", () => {
    const loudChunk = createChunk(CHUNK_SIZE, 0.1);
    const quietChunk = createChunk(CHUNK_SIZE, 0.0);

    // Trigger speech first
    for (let i = 0; i < 11; i++) vad.process(loudChunk);
    expect(vad.process(loudChunk).isSpeech).toBe(true);

    // Feed silence for 200ms (20 chunks) — less than minSilenceDuration (300ms)
    for (let i = 0; i < 20; i++) {
      const result = vad.process(quietChunk);
      expect(result.isSpeech).toBe(true);
      expect(result.speechEnd).toBe(false);
    }

    // Resume speech — should stay active without re-triggering speechStart
    const resumeResult = vad.process(loudChunk);
    expect(resumeResult.isSpeech).toBe(true);
    expect(resumeResult.speechStart).toBe(false);
  });

  it("ends speech after minSilenceDuration", () => {
    const loudChunk = createChunk(CHUNK_SIZE, 0.1);
    const quietChunk = createChunk(CHUNK_SIZE, 0.0);

    // Trigger speech
    for (let i = 0; i < 11; i++) vad.process(loudChunk);

    // Feed silence for 29 chunks (290ms) — still speech
    for (let i = 0; i < 29; i++) {
      expect(vad.process(quietChunk).isSpeech).toBe(true);
    }

    // 30th chunk (300ms) — triggers silence
    const endResult = vad.process(quietChunk);
    expect(endResult.isSpeech).toBe(false);
    expect(endResult.speechEnd).toBe(true);

    // Next chunk — stay silent, no new end
    const nextResult = vad.process(quietChunk);
    expect(nextResult.isSpeech).toBe(false);
    expect(nextResult.speechEnd).toBe(false);
  });

  it("adapts noise floor downward during extended silence", () => {
    const quietChunk = createChunk(CHUNK_SIZE, 0.001); // Very quiet

    const initialResult = vad.process(quietChunk);
    const initialNoiseFloor = initialResult.noiseFloor!;

    // Process many quiet chunks
    for (let i = 0; i < 50; i++) vad.process(quietChunk);

    const finalResult = vad.process(quietChunk);
    const finalNoiseFloor = finalResult.noiseFloor!;

    // Noise floor should decrease toward actual signal energy (0.001)
    // Initial noise floor is 0.005, so it should drop
    expect(finalNoiseFloor).toBeLessThan(initialNoiseFloor);
  });

  it("uses SNR-based detection with fallback energy threshold", () => {
    // Create a chunk with moderate energy but high relative to noise floor
    // After adaptation, noise floor will be low, so SNR will trigger
    const quietChunk = createChunk(CHUNK_SIZE, 0.002);
    const loudChunk = createChunk(CHUNK_SIZE, 0.15);

    // Adapt noise floor down first
    for (let i = 0; i < 30; i++) vad.process(quietChunk);

    // Now loud chunk should trigger via SNR even though energy alone might be close
    const result = vad.process(loudChunk);
    expect(result.snr).toBeDefined();
    expect(result.snr!).toBeGreaterThan(3);
  });

  it("resets state correctly", () => {
    const loudChunk = createChunk(CHUNK_SIZE, 0.1);

    // Trigger speech
    for (let i = 0; i < 11; i++) vad.process(loudChunk);
    expect(vad.process(loudChunk).isSpeech).toBe(true);

    // Reset
    vad.reset();

    // Verify silence, no speechEnd triggered (was reset, not transitioned)
    const result = vad.process(createChunk(CHUNK_SIZE, 0));
    expect(result.isSpeech).toBe(false);
    expect(result.speechEnd).toBe(false);
    expect(result.noiseFloor).toBeCloseTo(0.005, 2); // Reset to initial estimate (lenient — some adaptation may have occurred)
  });

  it("updates configuration at runtime", () => {
    vad.updateConfig({ minSpeechDuration: 200 });

    const loudChunk = createChunk(CHUNK_SIZE, 0.1);

    // 150ms (15 chunks) — used to be enough with 100ms threshold, now insufficient
    for (let i = 0; i < 15; i++) {
      expect(vad.process(loudChunk).isSpeech).toBe(false);
    }

    // 210ms total — should now trigger
    for (let i = 0; i < 6; i++) vad.process(loudChunk);
    expect(vad.process(loudChunk).isSpeech).toBe(true);
  });

  it("getNoiseFloor and getSnr return current values", () => {
    const result = vad.process(createChunk(CHUNK_SIZE, 0.05));
    expect(vad.getNoiseFloor()).toBeGreaterThan(0);
    expect(typeof vad.getSnr()).toBe("number");
  });
});
