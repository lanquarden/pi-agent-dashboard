## Design: Shared Streaming Transcription Core

### Architecture overview

The streaming pipeline is composed of four layers:

```
Layer 1: Audio Source          → pushes Float32Array PCM chunks
Layer 2: StreamingTranscriber  → orchestrates pipeline
Layer 3: Transcription Engine  → parakeet.js model.transcribe()
Layer 4: UI                    → React hook displaying mature/pending text
```

The shared core (layer 2) is platform-independent. Adapters (layers 1, 3) are platform-specific.

### Abstract interfaces (`types.ts`)

```ts
/** Produces 16kHz mono PCM Float32Array chunks. */
export interface IAudioSource {
  onChunk(cb: (chunk: Float32Array) => void): () => void;
  start(): Promise<void>;
  stop(): void;
  isActive(): boolean;
}

/** Audible speech detection. */
export interface IVAD {
  process(chunk: Float32Array): { isSpeech: boolean; energy: number };
  isSpeechActive(): boolean;
  reset(): void;
}

/** Circular buffer of audio samples with frame-based addressing. */
export interface IRingBuffer {
  write(chunk: Float32Array): void;
  read(startFrame: number, endFrame: number): Float32Array;
  getCurrentFrame(): number;
  getBaseFrameOffset(): number;
  getCurrentTime(): number;
  reset(): void;
}

/** Window-level transcription. Returns timestamped words. */
export interface ITranscriptionEngine {
  transcribe(
    audio: Float32Array,
    sampleRate: number,
    opts?: TranscribeOpts,
  ): Promise<TranscribeResult>;
  resetCache?(): void;
}

export interface TranscribeOpts {
  returnTimestamps?: boolean;
  returnTokenIds?: boolean;
  timeOffset?: number;
  frameStride?: number;
  incremental?: { cacheKey: string; prefixSeconds: number };
  prefixSamples?: number;
}

export interface TranscribeResult {
  utterance_text: string;
  words?: Array<{ text: string; start_time: number; end_time: number; confidence?: number }>;
  metrics?: { preprocess_ms: number; encode_ms: number; decode_ms: number; total_ms: number };
}
```

### EnergyVAD

Direct port from keet's `src/lib/vad/EnergyVAD.ts`. Uses SNR-based detection with adaptive noise floor:

```
For each chunk:
  1. Compute RMS energy
  2. Calculate SNR = 10 * log10(energy / noiseFloor)
  3. Speech if SNR > snrThreshold (3 dB) OR energy > fallbackThreshold
  4. Update noise floor via EMA (fast adaptation for first 1s, then slow)
  5. State machine: speech → silent requires minSilenceFrames; silent → speech requires minSpeechFrames
```

Configurable: `energyThreshold`, `minSpeechDuration`, `minSilenceDuration`, `sampleRate`.

### UtteranceBasedMerger

Direct port from keet's `src/lib/transcription/UtteranceBasedMerger.ts`.

```
On each ASR window result:
  1. Extract words + timestamps from ASR result
  2. Split utterance text into sentences (wink-nlp, heuristic fallback)
  3. All sentences except the last → finalized candidates
  4. Dedup finalized candidates against finalizedSentencesMeta (normalized text + end-time tolerance)
  5. Non-duplicate finalized sentences → merge into mergedTranscript, advance matureCursorTime
  6. Last sentence → pending (immature), displayed dimly in UI
  7. On flush/silence timeout → finalize pending if punctuation-complete (ends with .!?)
```

Key behaviors:
- Mature cursor moves forward only on finalized sentences
- Pending text is always the last sentence of the most recent window
- Dedup prevents the same sentence from being emitted twice when overlapping windows produce the same text
- wink-nlp for NLP sentence splitting; falls back to regex `[^.!?]+[.!?]+|[^.!?]+$` if NLP unavailable

### WindowBuilder

Direct port from keet's `src/lib/transcription/WindowBuilder.ts`.

```
State:
  - matureCursorFrame: where transcription is stable
  - sentenceEnds[]: last N finalized sentence boundary frames
  - firstSentenceReceived: whether any sentence has finalized

buildWindow():
  - endFrame = ringBuffer.getCurrentFrame()
  - If no data → return null
  - Before first sentence: window from base to end (clamped to maxDuration)
  - After first sentence: window from matureCursor to end
  - Clamp to minDuration (3s) and maxDuration (30s)
  - VAD boundary refinement: nudge start frame to nearest silence boundary
  - If start >= end → return null
  - Return { startFrame, endFrame, durationSeconds, isInitial }
```

Key parameters: `minDurationSec: 3.0`, `maxDurationSec: 30.0`, `minInitialDurationSec: 1.5`.

### StreamingTranscriber (orchestrator)

```ts
export class StreamingTranscriber {
  constructor(
    private audioSource: IAudioSource,
    private ringBuffer: IRingBuffer,
    private vad: IVAD,
    private windowBuilder: WindowBuilder,
    private engine: ITranscriptionEngine,
    private merger: UtteranceBasedMerger,
    private callbacks: StreamingCallbacks,
  ) {}

  async start(): Promise<void> {
    this.audioSource.onChunk((chunk) => this.handleChunk(chunk));
    await this.audioSource.start();
  }

  private async handleChunk(chunk: Float32Array): Promise<void> {
    // 1. Push to ring buffer
    this.ringBuffer.write(chunk);

    // 2. Run VAD
    this.vad.process(chunk);

    // 3. Build window
    const window = this.windowBuilder.buildWindow();
    if (!window) return;

    // 4. Extract audio
    const audio = this.ringBuffer.read(window.startFrame, window.endFrame);
    const overlapSec = this.windowBuilder.getMatureCursorTime();

    // 5. Transcribe with incremental cache
    const result = await this.engine.transcribe(audio, 16000, {
      returnTimestamps: true,
      returnTokenIds: true,
      timeOffset: window.startFrame / 16000,
      frameStride: 1,
      incremental: overlapSec > 0
        ? { cacheKey: 'streaming', prefixSeconds: overlapSec }
        : undefined,
    });

    // 6. Feed into merger
    const mergerResult = this.merger.processASRResult({
      utterance_text: result.utterance_text,
      words: result.words?.map((w) => ({
        text: w.text,
        start_time: w.start_time,
        end_time: w.end_time,
        confidence: w.confidence,
      })),
      end_time: window.endFrame / 16000,
    });

    // 7. Emit partial result
    this.callbacks.onPartial({
      matureText: mergerResult.matureText,
      pendingText: mergerResult.immatureText,
      fullText: mergerResult.fullText,
    });
  }

  stop(): string {
    this.audioSource.stop();
    this.merger.forceFinalizeAll();
    return this.merger.getMatureText();
  }

  reset(): void {
    this.ringBuffer.reset();
    this.vad.reset();
    this.windowBuilder.reset();
    this.merger.reset();
    this.engine.resetCache?.();
  }
}
```

### Client adapters

#### BrowserAudioSource

Uses `AudioWorklet` (replacing the current `ScriptProcessorNode`) for zero-main-thread-buffering capture. The worklet resamples from device rate to 16kHz and emits `Float32Array` chunks via `port.postMessage`.

Alternatively, for simplicity, keep the existing `ScriptProcessorNode` approach wrapped behind `IAudioSource`. The AudioWorklet upgrade is a performance optimization that can be done later.

#### BrowserRingBuffer

Standard circular buffer backed by `Float32Array`. Same algorithm as the Node version.

Key: `write()`, `read(startFrame, endFrame)`, `getCurrentFrame()`, `getCurrentTime() = currentFrame / sampleRate`.

#### BrowserInferenceEngine

Web Worker bridge. The worker holds the parakeet.js model instance (loaded via `fromHub`/`fromUrls`). Main thread sends `{ type: 'TRANSCRIBE', audio, opts }`, worker responds with `{ type: 'TRANSCRIBE_RESULT', result }`. Uses `Transferable` for zero-copy audio buffer transfer.

### Server adapters

#### WebSocketAudioSource

The server receives `voice_input_stream_chunk` messages from the browser — each contains a base64-encoded Float32Array chunk. The adapter decodes and pushes them into the transcriber. It implements `IAudioSource` with:
- `start()`: called when `voice_input_stream_start` arrives
- `stop()`: called when `voice_input_stream_stop` arrives
- `onChunk()`: fires for each decoded chunk

#### NodeRingBuffer

Same circular buffer algorithm as BrowserRingBuffer, but backed by `Buffer` (or `Float32Array`) for Node compatibility.

#### NodeInferenceEngine

Direct call to parakeet.js `model.transcribe()` — no worker needed since Node has native threads via onnxruntime-node. The model is loaded once at startup (via existing `ensureParakeetModel`).

### Protocol

```
Browser                                    Server
  │                                          │
  │── voice_input_stream_start ──────────────│  creates StreamingTranscriber for session
  │        { sessionId }                     │
  │                                          │
  │── voice_input_stream_chunk ──────────────│  decoded → pushed to transcriber
  │        { sessionId, chunk: "<base64>",   │
  │          seq: 0 }                        │
  │                                          │── voice_input_partial ──→
  │                                          │        { sessionId,
  │    ←── (same as above, partial) ────────│          matureText: "Hello world",
  │                                          │          pendingText: "how are",
  │        { sessionId, matureText,          │          seq: 0 }
  │          pendingText, seq: 0 }           │
  │                                          │
  │── voice_input_stream_chunk ──────────────│  decoded → pushed; window fires
  │        { sessionId, chunk: "<base64>",   │
  │          seq: 1 }                        │
  │                                          │── voice_input_partial ──→
  │    ←── { matureText: "Hello world.",     │
  │          pendingText: "how are you",     │
  │          seq: 1 }                        │
  │                                          │
  │── voice_input_stream_stop ───────────────│  forceFinalizeAll(); destroy transcriber
  │        { sessionId }                     │── voice_input_final ──→
  │    ←── { sessionId, fullText:            │
  │          "Hello world. How are you?" }   │
```

### Config schema addition

```json
{
  "streamEnabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable real-time streaming transcription. Shows partial results as you speak."
  }
}
```

### Client-side streaming flow in MicButton

When `streamEnabled: true`:
1. Push-to-talk: hold starts streaming transcriber, display shows `matureText` + dim `pendingText` in real time. Release calls `stop()` → gets final text → `onInsertText`.
2. Toggle: first click starts, display shows live text. Second click stops → final text inserted.

When `streamEnabled: false` (default): existing one-shot behavior.

### wink-nlp dependency

UtteranceBasedMerger uses wink-nlp for NLP sentence splitting (better than regex). wink-nlp + wink-eng-lite-web-model are lightweight (~3MB combined), work in both browser and Node, and are a transitive dependency of parakeet.js already. If unavailable, the merger falls back to regex splitting.

### File structure

```
packages/voice-input-plugin/src/
  shared/
    streaming/
      types.ts                    # IAudioSource, IRingBuffer, IVAD, ITranscriptionEngine, etc.
      EnergyVAD.ts                # SNR-based VAD
      UtteranceBasedMerger.ts     # Sentence-level merge
      WindowBuilder.ts            # Cursor-based window construction
      StreamingTranscriber.ts     # Orchestrator
  client/
    adapters/
      BrowserAudioSource.ts       # getUserMedia → ScriptProcessorNode → IAudioSource
      BrowserRingBuffer.ts        # Float32Array ring buffer
      BrowserInferenceEngine.ts   # Web Worker → parakeet.js → ITranscriptionEngine
    client-streaming.ts           # useStreamingTranscription() React hook
  server/
    adapters/
      WebSocketAudioSource.ts     # WS chunk decoder → IAudioSource
      NodeRingBuffer.ts           # Buffer ring buffer
      NodeInferenceEngine.ts      # Direct onnxruntime-node → ITranscriptionEngine
    server-streaming.ts           # Per-session transcriber lifecycle manager
```

### Tests

- **Shared core tests** (pure logic, no platform deps):
  - EnergyVAD: speech/silence detection with known audio, noise floor adaptation, reset
  - UtteranceBasedMerger: sentence finalization, dedup, pending text tracking, forceFinalizeAll
  - WindowBuilder: window construction with various cursor positions, min/max constraints, VAD boundary nudge
  - StreamingTranscriber: integration test with mock audio source/engine/VAD
- **Client adapter tests**:
  - BrowserRingBuffer: write/read/overflow
  - BrowserInferenceEngine: mock parakeet.js → worker bridge contract
- **Server adapter tests**:
  - NodeRingBuffer: same tests as browser variant
  - server-streaming.ts: session lifecycle, chunk routing
- **UI tests**:
  - MicButton streaming mode: live text updates, final text insertion
