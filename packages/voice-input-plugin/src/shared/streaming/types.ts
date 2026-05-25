/**
 * Shared streaming transcription types.
 *
 * Platform-independent interfaces that the shared streaming core depends on.
 * Client and server adapters implement these interfaces for their respective
 * runtimes (browser Web APIs vs Node.js).
 */

// ── Audio source ────────────────────────────────────────────────────────────

/** Produces 16kHz mono PCM Float32Array chunks. */
export interface IAudioSource {
  /** Register a callback for each audio chunk. Returns unsubscribe function. */
  onChunk(cb: (chunk: Float32Array) => void): () => void;
  /** Start capturing audio. Resolves when the stream is active. */
  start(): Promise<void>;
  /** Stop capturing audio. */
  stop(): void;
  /** Whether the source is currently capturing. */
  isActive(): boolean;
}

// ── Voice Activity Detection ────────────────────────────────────────────────

/** Audible speech detection result. */
export interface VADResult {
  /** Whether speech is currently detected (after hysteresis). */
  isSpeech: boolean;
  /** True on the exact chunk where speech state transitions to active. */
  speechStart: boolean;
  /** True on the exact chunk where speech state transitions to silent. */
  speechEnd: boolean;
  /** Current RMS energy value. */
  energy: number;
  /** Adaptive noise floor estimate. */
  noiseFloor?: number;
  /** Current SNR in dB. */
  snr?: number;
}

/** Voice activity detector interface. */
export interface IVAD {
  /** Process an audio chunk and return detection result. */
  process(chunk: Float32Array): VADResult;
  /** Whether the detector is currently in speech state. */
  isSpeechActive(): boolean;
  /** Reset internal state (noise floor, counters). */
  reset(): void;
}

// ── Ring buffer ─────────────────────────────────────────────────────────────

/** Circular buffer of audio samples with frame-based addressing. */
export interface IRingBuffer {
  /** Write a chunk of samples at the current write position. */
  write(chunk: Float32Array): void;
  /** Read samples from [startFrame, endFrame). Returns a copy. */
  read(startFrame: number, endFrame: number): Float32Array;
  /** Current write position in global frame coordinates. */
  getCurrentFrame(): number;
  /** Base frame offset (frames discarded from the buffer). */
  getBaseFrameOffset(): number;
  /** Current time in seconds (currentFrame / sampleRate). */
  getCurrentTime(): number;
  /** Clear the buffer and reset all cursors. */
  reset(): void;
}

// ── Transcription engine ────────────────────────────────────────────────────

/** Options for a window-level transcription call. */
export interface TranscribeOpts {
  /** Language code hint (e.g. "en"). */
  language?: string;
  /** Whether to include per-word timestamps. */
  returnTimestamps?: boolean;
  /** Whether to include token IDs. */
  returnTokenIds?: boolean;
  /** Time offset for this window's audio in seconds. */
  timeOffset?: number;
  /** Decoder frame stride (default 1). */
  frameStride?: number;
  /** Incremental decoder cache for overlap reuse. */
  incremental?: {
    /** Cache key for decoder state lookup. */
    cacheKey: string;
    /** Number of seconds of audio that overlap with previous window. */
    prefixSeconds: number;
  };
  /** Number of prefix samples to reuse from mel cache (JS preprocessor). */
  prefixSamples?: number;
}

/** A single word from the transcription result. */
export interface TranscribeWord {
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number;
}

/** Window-level transcription result. */
export interface TranscribeResult {
  /** Full utterance text. */
  utterance_text: string;
  /** Per-word timestamps and confidence. */
  words?: TranscribeWord[];
  /** Performance metrics. */
  metrics?: {
    preprocess_ms: number;
    encode_ms: number;
    decode_ms: number;
    total_ms: number;
  };
}

/** Window-level transcription engine. */
export interface ITranscriptionEngine {
  /** Transcribe a window of audio. */
  transcribe(
    audio: Float32Array,
    sampleRate: number,
    opts?: TranscribeOpts,
  ): Promise<TranscribeResult>;
  /** Clear decoder cache state (for new sessions). */
  resetCache?(): void;
}

// ── Merger types ────────────────────────────────────────────────────────────

/** A word from an ASR window result (normalized for merger input). */
export interface ASRWord {
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number;
}

/** An ASR window result to feed into the merger. */
export interface ASRResult {
  utterance_text: string;
  words?: ASRWord[];
  end_time?: number;
  segment_id?: string;
}

/** A finalized or pending sentence. */
export interface MergerSentence {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  isMature: boolean;
  detectionMethod: "nlp" | "heuristic";
}

/** Result from UtteranceBasedMerger.processASRResult(). */
export interface MergerResult {
  /** Confirmed (stable) transcript text. */
  matureText: string;
  /** Tentative (pending) sentence text. */
  immatureText: string;
  /** Full transcript (mature + pending). */
  fullText: string;
  /** Time cursor of the last finalized sentence in seconds. */
  matureCursorTime: number;
  /** Number of sentences detected in this window. */
  totalSentences: number;
  /** All mature sentences. */
  allMatureSentences: MergerSentence[];
  /** Current pending sentence. */
  pendingSentence: MergerSentence | null;
}

// ── Streaming callbacks ─────────────────────────────────────────────────────

/** Callbacks emitted by StreamingTranscriber on each partial result. */
export interface StreamingCallbacks {
  /** Fired when new partial transcript is available. */
  onPartial(result: { matureText: string; pendingText: string; fullText: string }): void;
  /** Fired on unrecoverable error. */
  onError?(error: Error): void;
}

// ── Window builder config ───────────────────────────────────────────────────

/** Configuration for WindowBuilder. */
export interface WindowBuilderConfig {
  /** Audio sample rate in Hz (default: 16000). */
  sampleRate: number;
  /** Minimum window duration in seconds (default: 3.0). */
  minDurationSec: number;
  /** Maximum window duration in seconds (default: 30.0). */
  maxDurationSec: number;
  /** Minimum duration before first sentence (default: 1.5). */
  minInitialDurationSec: number;
  /** Whether to use VAD for boundary refinement (default: true). */
  useVadBoundaries: boolean;
  /** VAD silence threshold for boundary detection (default: 0.3). */
  vadSilenceThreshold: number;
  /** Enable debug logging (default: false). */
  debug: boolean;
}

/** Default WindowBuilderConfig. */
export const DEFAULT_WINDOW_BUILDER_CONFIG: WindowBuilderConfig = {
  sampleRate: 16000,
  minDurationSec: 3.0,
  maxDurationSec: 30.0,
  minInitialDurationSec: 1.5,
  useVadBoundaries: true,
  vadSilenceThreshold: 0.3,
  debug: false,
};

// ── Energy VAD config ───────────────────────────────────────────────────────

/** Configuration for EnergyVAD. */
export interface EnergyVADConfig {
  /** Fallback energy threshold for speech detection. */
  energyThreshold: number;
  /** Minimum speech duration in ms before transitioning to speech. */
  minSpeechDuration: number;
  /** Minimum silence duration in ms before transitioning to silence. */
  minSilenceDuration: number;
  /** Audio sample rate in Hz (default: 16000). */
  sampleRate: number;
  /** SNR threshold in dB for speech detection (default: 3.0). */
  snrThreshold?: number;
}

/** Default EnergyVAD config. */
export const DEFAULT_ENERGY_VAD_CONFIG: EnergyVADConfig = {
  energyThreshold: 0.02,
  minSpeechDuration: 100,
  minSilenceDuration: 300,
  sampleRate: 16000,
  snrThreshold: 3.0,
};
