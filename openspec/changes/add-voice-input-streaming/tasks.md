## 1. Create shared streaming core

- [ ] 1.1 Create `packages/voice-input-plugin/src/shared/streaming/types.ts` — define `IAudioSource`, `IRingBuffer`, `IVAD`, `ITranscriptionEngine`, `TranscribeOpts`, `TranscribeResult`, `ASRResult`, `ASRWord`, `MergerSentence`, `MergerResult`, `StreamingCallbacks`, `WindowBuilderConfig`.
- [ ] 1.2 Port `EnergyVAD` from keet to `shared/streaming/EnergyVAD.ts`. Pure TypeScript, no platform deps. Includes SNR-based detection, adaptive noise floor with fast/slow EMA, speech/silence state machine with hysteresis.
- [ ] 1.3 Port `UtteranceBasedMerger` from keet to `shared/streaming/UtteranceBasedMerger.ts`. Pure TypeScript. Wink-nlp for sentence splitting with regex heuristic fallback. Dedup by normalized text + end-time tolerance. Mature cursor advancement. `processASRResult()`, `finalizePendingSentenceByTimeout()`, `forceFinalizeAll()`, `reset()`.
- [ ] 1.4 Port `WindowBuilder` from keet to `shared/streaming/WindowBuilder.ts`. Depends on `IRingBuffer` + `IVAD` interfaces. Cursor-based window construction with min/max duration constraints, VAD boundary refinement, initial/first-sentence modes. `buildWindow()`, `advanceMatureCursor()`, `markSentenceEnd()`, `reset()`.
- [ ] 1.5 Implement `StreamingTranscriber` orchestrator in `shared/streaming/StreamingTranscriber.ts`. Constructor accepts injected `IAudioSource`, `IRingBuffer`, `IVAD`, `WindowBuilder`, `ITranscriptionEngine`, `UtteranceBasedMerger`, `StreamingCallbacks`. `start()` subscribes to audio source. `handleChunk()` runs the full pipeline (buffer → VAD → window → transcribe → merge → emit). `stop()` finalizes and returns full text. `reset()` clears all state.

## 2. Implement client streaming adapters

- [ ] 2.1 Implement `BrowserRingBuffer` in `client/adapters/BrowserRingBuffer.ts`. Float32Array-backed circular buffer with `write`, `read(startFrame, endFrame)`, `getCurrentFrame()`, `getBaseFrameOffset()`, `getCurrentTime()`, `reset()`.
- [ ] 2.2 Implement `BrowserAudioSource` in `client/adapters/BrowserAudioSource.ts`. Wraps `getUserMedia` → `AudioContext` → `ScriptProcessorNode` behind `IAudioSource`. Emits 16kHz mono Float32Array chunks. `start()`, `stop()`, `onChunk()`, `isActive()`.
- [ ] 2.3 Implement `BrowserInferenceEngine` in `client/adapters/BrowserInferenceEngine.ts`. Creates a Web Worker that loads parakeet.js model and exposes `transcribe(audio, sampleRate, opts)`. Main thread sends messages; worker responds with results. Uses `Transferable` for zero-copy audio transfer. Implements `ITranscriptionEngine`.
- [ ] 2.4 Implement `useStreamingTranscription()` React hook in `client/client-streaming.ts`. Manages `StreamingTranscriber` lifecycle. Returns `{ matureText, pendingText, isListening, start, stop, error }`. Cleans up on unmount.

## 3. Implement server streaming adapters

- [ ] 3.1 Implement `NodeRingBuffer` in `server/adapters/NodeRingBuffer.ts`. Same algorithm as BrowserRingBuffer but using `Buffer`-backed circular storage. Implements `IRingBuffer`.
- [ ] 3.2 Implement `WebSocketAudioSource` in `server/adapters/WebSocketAudioSource.ts`. Implements `IAudioSource`. Accepts decoded PCM chunks via `pushChunk(chunk: Float32Array)`. Notifies `onChunk` subscribers. `start()`/`stop()` for lifecycle.
- [ ] 3.3 Implement `NodeInferenceEngine` in `server/adapters/NodeInferenceEngine.ts`. Wraps the existing `ensureParakeetModel` + parakeet.js `model.transcribe()` behind `ITranscriptionEngine`. Supports `incremental` cache option for overlap reuse. `resetCache()` clears decoder state.
- [ ] 3.4 Implement server streaming session manager in `server/server-streaming.ts`. Creates/destroys per-session `StreamingTranscriber` instances. Handles chunk accumulation and routing. Exports `getOrCreateStream(sessionId)`, `pushChunk(sessionId, chunk)`, `stopStream(sessionId)`, `cleanupStale()`.

## 4. Update protocol and server entry

- [ ] 4.1 Add new message types to protocol conventions (in-code types, no shared/protocol.ts changes needed — plugin messages are typed via handler registration).
- [ ] 4.2 Register `voice_input_stream_start` browser handler in `src/server/index.ts`. Creates `StreamingTranscriber` for session, wires `onPartial` callback to `ctx.broadcastToSubscribers({ type: "voice_input_partial", ... })`.
- [ ] 4.3 Register `voice_input_stream_chunk` handler. Decodes base64 chunk, pushes to session's `WebSocketAudioSource`.
- [ ] 4.4 Register `voice_input_stream_stop` handler. Calls `stream.stop()`, broadcasts `voice_input_final`, destroys transcriber.
- [ ] 4.5 Keep existing `voice_input_audio` handler (one-shot) intact. Route based on `streamEnabled` config or by message type — streaming uses new message types, one-shot uses the old type. No conflict.

## 5. Update MicButton for streaming mode

- [ ] 5.1 Read `streamEnabled` from plugin config. When false, use existing one-shot path (no code changes needed).
- [ ] 5.2 When `streamEnabled: true`:
  - Push-to-talk: on hold start → `streaming.start()`. Display `matureText` in normal text + `pendingText` in dim gray, updating live. On release → `streaming.stop()` → `onInsertText(fullText)`.
  - Toggle: on first click → `streaming.start()`. Display live text. On second click → `streaming.stop()` → `onInsertText`.
  - For server mode: send `voice_input_stream_start`/`chunk`/`stop` messages. Listen for `voice_input_partial` and `voice_input_final` events.
  - For client mode: use `useStreamingTranscription()` hook directly.
- [ ] 5.3 Update live text display area to show mature + pending text (instead of just status messages).
- [ ] 5.4 Error handling: surface streaming errors (Web Worker failure, ONNX error) in the live text area.

## 6. Update config schema

- [ ] 6.1 Add `streamEnabled` boolean property to `configSchema.json` (default: `false`).
- [ ] 6.2 Add `streamEnabled` to `VoiceInputConfig` TypeScript type in `client.tsx`.
- [ ] 6.3 Add streaming toggle to `VoiceInputSettings` component (shown when `transcriptionEngine` is configured).

## 7. Add wink-nlp dependency

- [ ] 7.1 Add `wink-nlp` and `wink-eng-lite-web-model` to `package.json` dependencies.
- [ ] 7.2 Run `npm install` in voice-input-plugin package.
- [ ] 7.3 Ensure wink-nlp imports work in both browser (Vite bundles) and Node (server-side plugin loading).

## 8. Tests

### 8.1 Shared core tests

- [ ] 8.1.1 `EnergyVAD.test.ts` — speech detection, silence detection, noise floor adaptation, hysteresis (minSpeechFrames/minSilenceFrames), reset, SNR calculation.
- [ ] 8.1.2 `UtteranceBasedMerger.test.ts` — sentence finalization from multi-sentence input, dedup of duplicate sentences, pending text tracking, forceFinalizeAll, reset, empty input handling, wink-nlp and heuristic fallback paths.
- [ ] 8.1.3 `WindowBuilder.test.ts` — initial window before first sentence, normal windows after cursor advance, min/max duration clamping, VAD boundary refinement, null return when insufficient audio.
- [ ] 8.1.4 `StreamingTranscriber.test.ts` — integration test with mock IAudioSource, IRingBuffer, IVAD, ITranscriptionEngine. Verifies pipeline: chunk → window → transcribe → merge → callback. Tests start/stop/reset lifecycle.

### 8.2 Client adapter tests

- [ ] 8.2.1 `BrowserRingBuffer.test.ts` — write/read roundtrip, overflow wrapping, frame offset tracking, reset, edge cases (empty read, read past end).
- [ ] 8.2.2 `BrowserInferenceEngine.test.ts` — worker bridge contract, transcribe call/response, incremental cache option passthrough, resetCache, error propagation.
- [ ] 8.2.3 `useStreamingTranscription.test.ts` — React hook lifecycle, text updates, start/stop, cleanup on unmount.

### 8.3 Server adapter tests

- [ ] 8.3.1 `NodeRingBuffer.test.ts` — same test coverage as BrowserRingBuffer.
- [ ] 8.3.2 `server-streaming.test.ts` — session lifecycle (create, pushChunk, stop), concurrent sessions, cleanup of stale sessions, broadcast messages.

### 8.4 UI tests

- [ ] 8.4.1 MicButton streaming mode — live text display with mature/pending separation, final text insertion on stop, error display.
- [ ] 8.4.2 MicButton one-shot regression — when `streamEnabled: false`, existing behavior unchanged.

## 9. Documentation

- [ ] 9.1 Update `docs/file-index-plugins.md` with new voice-input-plugin files (streaming core, adapters).
- [ ] 9.2 Add `AGENTS.md` Key Files entries for shared streaming core files.
