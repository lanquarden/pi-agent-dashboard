/**
 * Shared EnergyVAD — SNR-based Voice Activity Detection with adaptive noise floor.
 *
 * Ported from keet's src/lib/vad/EnergyVAD.ts.
 * Zero platform dependencies — pure Float32Array math, works in browser and Node.
 *
 * Algorithm:
 *   1. Compute RMS energy per chunk
 *   2. Calculate SNR = 10 * log10(energy / noiseFloor)
 *   3. Speech if SNR > snrThreshold OR energy > fallbackThreshold
 *   4. Adaptive noise floor via EMA: fast adaptation for first second, then slow
 *   5. State machine with hysteresis: minSpeechFrames before speech, minSilenceFrames before silence
 */
import type { EnergyVADConfig, VADResult } from "./types.js";

export class EnergyVAD {
  private config: Required<EnergyVADConfig> & { snrThreshold: number };
  private isSpeechActiveState: boolean = false;

  // Frame counters for hysteresis
  private speechConfirmationCounter: number = 0;
  private silenceConfirmationCounter: number = 0;

  private minSpeechFrames: number;
  private minSilenceFrames: number;

  // Adaptive noise floor
  private noiseFloor: number = 0.005;
  private snr: number = 0;
  private silenceDuration: number = 0;

  private readonly fastAdaptationRate = 0.15;
  private readonly normalAdaptationRate = 0.05;
  private readonly minBackgroundDuration = 1.0;

  constructor(config: Partial<EnergyVADConfig> = {}) {
    const snrThreshold = config.snrThreshold ?? 3.0;

    this.config = {
      energyThreshold: config.energyThreshold ?? 0.02,
      minSpeechDuration: config.minSpeechDuration ?? 100,
      minSilenceDuration: config.minSilenceDuration ?? 300,
      sampleRate: config.sampleRate ?? 16000,
      snrThreshold,
    };

    this.minSpeechFrames = Math.ceil(
      (this.config.minSpeechDuration / 1000) * this.config.sampleRate,
    );
    this.minSilenceFrames = Math.ceil(
      (this.config.minSilenceDuration / 1000) * this.config.sampleRate,
    );
  }

  /**
   * Process an audio chunk and return the VAD state.
   */
  process(chunk: Float32Array): VADResult {
    // 1. RMS energy
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) {
      sumSquares += chunk[i] * chunk[i];
    }
    const energy = Math.sqrt(sumSquares / chunk.length);
    const chunkDuration = chunk.length / this.config.sampleRate;

    // 2. SNR in dB
    const safeNoiseFloor = Math.max(0.0001, this.noiseFloor);
    this.snr = 10 * Math.log10(energy / safeNoiseFloor);

    // 3. Speech detection
    const isAboveSnr = this.snr > this.config.snrThreshold;
    const isAboveEnergy = energy > this.config.energyThreshold;
    const isSpeech = isAboveSnr || isAboveEnergy;

    // 4. Adaptive noise floor update
    if (!isSpeech) {
      this.silenceDuration += chunkDuration;
      const blendFactor = Math.min(1, this.silenceDuration / this.minBackgroundDuration);
      const rate =
        this.fastAdaptationRate * (1 - blendFactor) +
        this.normalAdaptationRate * blendFactor;
      this.noiseFloor = this.noiseFloor * (1 - rate) + energy * rate;
      this.noiseFloor = Math.max(0.00001, this.noiseFloor);
    } else {
      this.silenceDuration = 0;
    }

    // 5. State machine hysteresis
    let speechStart = false;
    let speechEnd = false;

    if (isSpeech) {
      this.silenceConfirmationCounter = 0;
      if (!this.isSpeechActiveState) {
        this.speechConfirmationCounter += chunk.length;
        if (this.speechConfirmationCounter >= this.minSpeechFrames) {
          this.isSpeechActiveState = true;
          speechStart = true;
        }
      }
    } else {
      this.speechConfirmationCounter = 0;
      if (this.isSpeechActiveState) {
        this.silenceConfirmationCounter += chunk.length;
        if (this.silenceConfirmationCounter >= this.minSilenceFrames) {
          this.isSpeechActiveState = false;
          speechEnd = true;
          this.silenceConfirmationCounter = 0;
        }
      }
    }

    return {
      isSpeech: this.isSpeechActiveState,
      speechStart,
      speechEnd,
      energy,
      noiseFloor: this.noiseFloor,
      snr: this.snr,
    };
  }

  /** Whether the detector is currently in speech state. */
  isSpeechActive(): boolean {
    return this.isSpeechActiveState;
  }

  /** Reset internal state. */
  reset(): void {
    this.isSpeechActiveState = false;
    this.speechConfirmationCounter = 0;
    this.silenceConfirmationCounter = 0;
    this.noiseFloor = 0.005;
    this.snr = 0;
    this.silenceDuration = 0;
  }

  /** Update configuration at runtime. */
  updateConfig(config: Partial<EnergyVADConfig>): void {
    if (config.minSpeechDuration !== undefined) {
      this.config.minSpeechDuration = config.minSpeechDuration;
      this.minSpeechFrames = Math.ceil(
        (this.config.minSpeechDuration / 1000) * this.config.sampleRate,
      );
    }
    if (config.minSilenceDuration !== undefined) {
      this.config.minSilenceDuration = config.minSilenceDuration;
      this.minSilenceFrames = Math.ceil(
        (this.config.minSilenceDuration / 1000) * this.config.sampleRate,
      );
    }
    if (config.energyThreshold !== undefined) {
      this.config.energyThreshold = config.energyThreshold;
    }
    if (config.snrThreshold !== undefined) {
      this.config.snrThreshold = config.snrThreshold;
    }
  }

  /** Get current noise floor estimate (for diagnostics). */
  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  /** Get current SNR in dB (for diagnostics). */
  getSnr(): number {
    return this.snr;
  }
}
