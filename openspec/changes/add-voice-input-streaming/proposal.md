## Why

The voice-input plugin (`add-voice-input-plugin`) implemented one-shot transcription only: the user holds the mic button, speaks, releases, then waits for the full transcript to appear. This is slow — there's no feedback until the recording ends, making it impossible to see what's being transcribed in real time. The keet project (`ysdede/keet`) demonstrates real-time streaming transcription using the same parakeet.js ONNX models, proving it's feasible.

Real-time streaming shows partial results as the user speaks: confirmed (mature) text plus a dim-gray pending sentence that updates live. This is the expected UX for voice input. Both client and server transcription paths should support it, and the core streaming logic should be shared code between them.

## What Changes

- **NEW**: `src/shared/streaming/` — platform-independent streaming transcription core ported from keet:
  - `EnergyVAD` — SNR-based voice activity detection with adaptive noise floor (pure math, works in browser + Node)
  - `UtteranceBasedMerger` — sentence-level merge of per-window ASR results; mature (confirmed) + pending (tentative) text streams, NLP sentence splitting, dedup by normalized text + timestamp
  - `WindowBuilder` — cursor-based overlapping window construction (mature cursor → current position) with min/max duration and VAD boundary refinement
  - `StreamingTranscriber` — orchestrator that wires audio chunks → ring buffer → VAD → window builder → inference → merger → partial result emits
  - `types.ts` — abstract interfaces (`IAudioSource`, `IRingBuffer`, `ITranscriptionEngine`, `IVAD`) that platform adapters implement
- **NEW**: Client streaming adapters in `packages/voice-input-plugin/src/client/`:
  - `BrowserAudioSource.ts` — AudioWorklet-based capture emitting 16kHz PCM chunks
  - `BrowserRingBuffer.ts` — Float32Array-backed circular buffer
  - `BrowserInferenceEngine.ts` — Web Worker bridge calling parakeet.js `model.transcribe()` with incremental cache
  - `useStreamingTranscription()` hook — React state management for mature/pending text
- **NEW**: Server streaming adapters in `packages/voice-input-plugin/src/server/`:
  - `WebSocketAudioSource.ts` — feeds browser-streamed PCM chunks into the transcriber
  - `NodeRingBuffer.ts` — Buffer-backed circular buffer
  - `NodeInferenceEngine.ts` — direct onnxruntime-node via parakeet.js `model.transcribe()` with incremental cache
  - `server-streaming.ts` — per-session streaming session manager (chunk accumulation → transcriber lifecycle)
- **MODIFIED**: `src/client.tsx` — MicButton gains streaming mode: live text display showing `matureText` + dim `pendingText`, toggle/push-to-talk extended with streaming lifecycle
- **MODIFIED**: `src/server/index.ts` — new protocol handlers for streaming (`voice_input_stream_start`/`chunk`/`stop`), per-session `StreamingTranscriber` instances
- **NEW**: Protocol messages:
  - Browser → Server: `voice_input_stream_start { sessionId }`, `voice_input_stream_chunk { sessionId, chunk, seq }`, `voice_input_stream_stop { sessionId }`
  - Server → Browser: `voice_input_partial { sessionId, matureText, pendingText, seq }`, `voice_input_final { sessionId, fullText }`
- **NEW**: `streamEnabled` config option in `configSchema.json`

### Architecture

```
┌─ Shared Core (src/shared/streaming/) ─────────────────────────┐
│  EnergyVAD  ──┐                                               │
│  WindowBuilder ─┤                                              │
│  UtteranceBasedMerger ─┤                                       │
│  StreamingTranscriber ─┤ (orchestrator)                        │
│  types.ts (IAudioSource, IRingBuffer, ITranscriptionEngine) ──┘│
└────────────────────────────────────────────────────────────────┘
         │                          │
    ┌────▼────────┐          ┌──────▼──────────┐
    │ Client Adapters│        │ Server Adapters    │
    │ AudioWorklet  │        │ WebSocket chunks   │
    │ Float32Array   │        │ Buffer-backed      │
    │ Web Worker     │        │ Direct ONNX        │
    └───────────────┘        └────────────────────┘
```

### Algorithm (per audio chunk)

1. Audio chunk arrives → push to ring buffer
2. EnergyVAD processes chunk → updates speech/silence state
3. WindowBuilder checks: enough new audio since last window? → builds window [mature_cursor, current] with VAD boundary refinement
4. If window built: extract audio from ring buffer, feed to `ITranscriptionEngine.transcribe()` with `incremental: { cacheKey, prefixSeconds }` for overlap reuse
5. ASR result fed to UtteranceBasedMerger → produces mature (confirmed) text + pending sentence
6. Emit `{ matureText, pendingText }` via callback

### Why UtteranceBasedMerger over LCSPTFAMerger

The keet v3 pipeline uses LCS+PTFA token-level merging. Keet's v4 pipeline (UtteranceBasedMerger) is simpler and more aligned with our use case:
- Works sentence-by-sentence (natural for display)
- Avoids token-level merge complexity (LCS anchor search, frame-alignment, vignetting)
- Simpler to test and debug
- Clean mature/pending UI separation (visible in keet's UI)

### Why incremental cache matters

Without incremental caching, each ~5s window re-decodes the overlap prefix from scratch. With `incremental: { cacheKey: 'streaming', prefixSeconds }`, the decoder resumes from cached LSTM state at the overlap boundary, saving ~80% of decode time. Without this, real-time would be infeasible — a 5s window takes ~200ms to decode, so with 80% overlap you'd lose ~160ms per window to redundant work.

### One-shot mode preserved

The existing one-shot transcription path is kept intact. Streaming is opt-in via a `streamEnabled` config toggle (default: off initially, to avoid breaking existing users). When `streamEnabled: false`, behavior is identical to today.

## Capabilities

### New Capabilities

- `voice-input-streaming-core`: Shared streaming transcription core (EnergyVAD, UtteranceBasedMerger, WindowBuilder, StreamingTranscriber) with abstract platform interfaces.
- `voice-input-streaming-client`: Browser-side streaming adapters (AudioWorklet capture, ring buffer, Web Worker inference, React hook).
- `voice-input-streaming-server`: Server-side streaming adapters (WebSocket chunk routing, ring buffer, direct ONNX inference, session manager).

### Modified Capabilities

- `voice-input-plugin`: MicButton gains live text display for streaming mode; existing one-shot behavior preserved behind config toggle.

## Impact

- **NEW files** (~10 files):
  - `packages/voice-input-plugin/src/shared/streaming/EnergyVAD.ts`
  - `packages/voice-input-plugin/src/shared/streaming/UtteranceBasedMerger.ts`
  - `packages/voice-input-plugin/src/shared/streaming/WindowBuilder.ts`
  - `packages/voice-input-plugin/src/shared/streaming/StreamingTranscriber.ts`
  - `packages/voice-input-plugin/src/shared/streaming/types.ts`
  - `packages/voice-input-plugin/src/client/adapters/BrowserAudioSource.ts`
  - `packages/voice-input-plugin/src/client/adapters/BrowserRingBuffer.ts`
  - `packages/voice-input-plugin/src/client/adapters/BrowserInferenceEngine.ts`
  - `packages/voice-input-plugin/src/client/client-streaming.ts` (hook)
  - `packages/voice-input-plugin/src/server/adapters/NodeRingBuffer.ts`
  - `packages/voice-input-plugin/src/server/adapters/NodeInferenceEngine.ts`
  - `packages/voice-input-plugin/src/server/adapters/WebSocketAudioSource.ts`
  - `packages/voice-input-plugin/src/server/server-streaming.ts`
- **MODIFIED files** (~4 files):
  - `packages/voice-input-plugin/src/client.tsx` — streaming mode in MicButton
  - `packages/voice-input-plugin/src/client/client-transcription.ts` — extract shared inference interface
  - `packages/voice-input-plugin/src/server/index.ts` — streaming protocol handlers
  - `packages/voice-input-plugin/configSchema.json` — `streamEnabled` option
- **Tests**: New tests for shared core (EnergyVAD, UtteranceBasedMerger, WindowBuilder, StreamingTranscriber), client adapters, server adapters, and streaming-mode MicButton behavior.
- **Backward compatibility**: Additive only. One-shot path unchanged. `streamEnabled` defaults to `false`. New protocol messages are ignored by old clients/servers (no handler registered).
- **Dependencies**: `wink-nlp` + `wink-eng-lite-web-model` (npm, works in both browser and Node, for NLP sentence splitting in UtteranceBasedMerger). Already in parakeet.js transitive deps.

## References

- keet streaming architecture: https://github.com/ysdede/keet (TokenStreamTranscriber, UtteranceBasedMerger, WindowBuilder, EnergyVAD)
- parakeet.js incremental decode: `incremental: { cacheKey, prefixSeconds }` option on `model.transcribe()`
- Existing voice-input plugin: `openspec/changes/add-voice-input-plugin/`
- Slot taxonomy: `packages/shared/src/dashboard-plugin/slot-types.ts`
