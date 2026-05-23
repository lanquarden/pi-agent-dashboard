## ADDED: voice-input-streaming-core

Shared streaming transcription core (EnergyVAD, UtteranceBasedMerger, WindowBuilder, StreamingTranscriber) with abstract platform interfaces (IAudioSource, IRingBuffer, IVAD, ITranscriptionEngine). Platform-independent pure TypeScript — compiled identically for browser and Node.

### Requirements

- **REQ-STREAM-CORE-01**: `EnergyVAD` SHALL implement SNR-based voice activity detection with adaptive noise floor tracking using exponential moving average (fast adaptation for first 1s, slow thereafter).
- **REQ-STREAM-CORE-02**: `EnergyVAD` SHALL maintain a speech/silence state machine with configurable minimum speech duration (minSpeechFrames) and minimum silence duration (minSilenceFrames) hysteresis to filter transients.
- **REQ-STREAM-CORE-03**: `UtteranceBasedMerger` SHALL split each ASR window result into sentences (wink-nlp preferred, regex heuristic fallback), promote all but the last sentence to "mature" (confirmed), and retain the last sentence as "pending" (tentative).
- **REQ-STREAM-CORE-04**: `UtteranceBasedMerger` SHALL deduplicate finalized sentences by (normalized text + end-time within 0.15s tolerance) to prevent the same sentence from being emitted twice across overlapping windows.
- **REQ-STREAM-CORE-05**: `UtteranceBasedMerger` SHALL advance the mature cursor time to the end time of each newly finalized sentence.
- **REQ-STREAM-CORE-06**: `WindowBuilder` SHALL construct transcription windows from the mature cursor frame to the current buffer head, respecting minimum duration (3s) and maximum duration (30s) constraints.
- **REQ-STREAM-CORE-07**: `WindowBuilder` SHALL return `null` when insufficient audio exists for a valid window (below minDuration or start >= end).
- **REQ-STREAM-CORE-08**: `StreamingTranscriber` SHALL orchestrate the full pipeline per audio chunk: buffer → VAD → window build → engine.transcribe() → merger.processASRResult() → callback.onPartial().
- **REQ-STREAM-CORE-09**: `StreamingTranscriber.stop()` SHALL call `merger.forceFinalizeAll()` and return the complete mature text.
- **REQ-STREAM-CORE-10**: `StreamingTranscriber.reset()` SHALL clear all state (ring buffer, VAD, window builder, merger, engine cache).
- **REQ-STREAM-CORE-11**: All shared core classes (`EnergyVAD`, `UtteranceBasedMerger`, `WindowBuilder`, `StreamingTranscriber`) SHALL have zero platform dependencies — no DOM, no Node built-ins, no Web APIs beyond `Float32Array` and standard ES2022.

### Interface contracts

- **REQ-STREAM-IFACE-01**: `IAudioSource` SHALL define `onChunk(cb) → unsubscribe`, `start() → Promise<void>`, `stop()`, and `isActive()`.
- **REQ-STREAM-IFACE-02**: `IVAD` SHALL define `process(chunk) → { isSpeech, energy }`, `isSpeechActive()`, and `reset()`.
- **REQ-STREAM-IFACE-03**: `IRingBuffer` SHALL define `write(chunk)`, `read(startFrame, endFrame) → Float32Array`, `getCurrentFrame()`, `getBaseFrameOffset()`, `getCurrentTime()`, and `reset()`.
- **REQ-STREAM-IFACE-04**: `ITranscriptionEngine` SHALL define `transcribe(audio, sampleRate, opts?) → Promise<TranscribeResult>` and optional `resetCache()`.

## ADDED: voice-input-streaming-client

Browser-side streaming adapters and React hook that implement the shared core interfaces using Web APIs.

### Requirements

- **REQ-STREAM-CLIENT-01**: `BrowserRingBuffer` SHALL implement `IRingBuffer` using a `Float32Array`-backed circular buffer with frame-based read/write addressing and sample-accurate timestamp tracking.
- **REQ-STREAM-CLIENT-02**: `BrowserAudioSource` SHALL implement `IAudioSource` using `getUserMedia` → `AudioContext` → `ScriptProcessorNode` capturing 16kHz mono PCM Float32Array chunks.
- **REQ-STREAM-CLIENT-03**: `BrowserInferenceEngine` SHALL implement `ITranscriptionEngine` using a Web Worker that loads the parakeet.js model and exposes `transcribe()` via postMessage. Audio buffers SHALL be transferred with zero-copy `Transferable`.
- **REQ-STREAM-CLIENT-04**: `BrowserInferenceEngine` SHALL pass `incremental: { cacheKey, prefixSeconds }` to `model.transcribe()` for decoder state reuse across overlapping windows.
- **REQ-STREAM-CLIENT-05**: `useStreamingTranscription()` React hook SHALL manage `StreamingTranscriber` lifecycle, expose `{ matureText, pendingText, isListening, start, stop, error }`, and clean up on unmount.

## ADDED: voice-input-streaming-server

Server-side streaming adapters that implement the shared core interfaces using Node APIs and the existing onnxruntime-node Parakeet engine.

### Requirements

- **REQ-STREAM-SERVER-01**: `NodeRingBuffer` SHALL implement `IRingBuffer` using a `Buffer`-backed circular buffer with identical API and behavior to `BrowserRingBuffer`.
- **REQ-STREAM-SERVER-02**: `WebSocketAudioSource` SHALL implement `IAudioSource`. `pushChunk(Float32Array)` SHALL notify `onChunk` subscribers. `start()`/`stop()` SHALL control lifecycle.
- **REQ-STREAM-SERVER-03**: `NodeInferenceEngine` SHALL implement `ITranscriptionEngine` wrapping the existing `ensureParakeetModel()` + `model.transcribe()` with `incremental` cache support.
- **REQ-STREAM-SERVER-04**: Server streaming session manager SHALL create one `StreamingTranscriber` per session on `voice_input_stream_start`, route chunk messages to it, finalize on `voice_input_stream_stop`, and clean up stale sessions after 30s TTL.
- **REQ-STREAM-SERVER-05**: The server SHALL broadcast `voice_input_partial { sessionId, matureText, pendingText, seq }` on each partial result and `voice_input_final { sessionId, fullText }` on stream stop.

## MODIFIED: voice-input-plugin

Existing MicButton and config extended for streaming mode. One-shot path preserved unchanged.

### Requirements

- **REQ-STREAM-PLUGIN-01**: `MicButton` SHALL read `streamEnabled` from plugin config. When `false`, existing one-shot behavior SHALL be preserved exactly.
- **REQ-STREAM-PLUGIN-02**: When `streamEnabled: true`, `MicButton` SHALL display live streaming text: `matureText` in normal style, `pendingText` in dimmed style, updating in real time as the user speaks.
- **REQ-STREAM-PLUGIN-03**: When `streamEnabled: true` in push-to-talk mode: hold SHALL start the streaming transcriber; release SHALL call `stop()` → `onInsertText(fullText)`.
- **REQ-STREAM-PLUGIN-04**: When `streamEnabled: true` in toggle mode: first click SHALL start; second click SHALL stop → insert final text.
- **REQ-STREAM-PLUGIN-05**: When `streamEnabled: true` and `transcriptionEngine: "server"`, the client SHALL send `voice_input_stream_start`/`chunk`/`stop` protocol messages and render partial results from `voice_input_partial` events.
- **REQ-STREAM-PLUGIN-06**: `configSchema.json` SHALL include `streamEnabled` (boolean, default `false`).
- **REQ-STREAM-PLUGIN-07**: `VoiceInputSettings` SHALL display the streaming toggle when `transcriptionEngine` is configured.
