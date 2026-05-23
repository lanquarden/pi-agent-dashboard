## 1. Add `command-input-action` slot to dashboard shell

- [x] 1.1 Add `"command-input-action"` to `SlotId` type union in `packages/shared/src/dashboard-plugin/slot-types.ts`.
- [x] 1.2 Add `"command-input-action"` to `SessionScopedSlot` type for `forSession`/`forSessionRendered` predicate filtering.
- [x] 1.3 Add `SLOT_DEFINITIONS` entry with `multiplicity: "many"`, `payloadTier: "react-only"`, and description.
- [x] 1.4 Add `{ session, pluginContext, onInsertText }` to `SlotPropsMap` in `packages/shared/src/dashboard-plugin/slot-props.ts`.
- [x] 1.5 Add `CommandInputActionSlot` consumer component in `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`. Accepts `session` and `onInsertText` props. Reads claims from registry, wraps each in `SlotErrorBoundary` + `CurrentPluginLayer`. Renders intents via `renderIntent`.
- [x] 1.6 Render `<CommandInputActionSlot>` in `CommandInput.tsx` button row, before Send/Stop buttons. Only renders when `session` prop is provided.
- [x] 1.7 Pass `session={selectedSession}` to `<CommandInput>` in `App.tsx`.
- [x] 1.8 Verify types compile: `npx tsc --noEmit` in shared, dashboard-plugin-runtime, and client packages.

## 2. Scaffold `packages/voice-input-plugin/`

- [x] 2.1 Create `package.json` with `pi-dashboard-plugin` manifest: id `voice-input`, claims for `command-input-action` (MicButton) and `settings-section` (VoiceInputSettings), both client and server entries.
- [x] 2.2 Create `configSchema.json` (JSON Schema 7): mode (push-to-talk/toggle), transcriptionEngine (client/server), serverEngine (parakeet-onnx/openai-whisper), language, vadThreshold, parakeetModelUrl, parakeetModelRepo, openaiApiKey.
- [x] 2.3 Create `tsconfig.json` and `vitest.config.ts` following existing plugin patterns.
- [x] 2.4 Verify Vite plugin discovers the plugin: `npm run build` shows `[plugin-loader] discovered 8 plugin(s): ... voice-input ...`.
- [x] 2.5 Verify generated `plugin-registry.tsx` includes voice-input with correct claims.

## 3. Implement MicButton component

- [x] 3.1 Render mic icon button (`@mdi/js` mdiMicrophone / mdiMicrophoneOff) in `command-input-action` slot.
- [x] 3.2 Push-to-talk mode: `onPointerDown` starts 200ms hold timer, hold triggers recording; `onPointerUp` stops and transcribes.
- [x] 3.3 Toggle mode: `onClick` toggles recording on/off.
- [x] 3.4 Audio capture via `getUserMedia` → `AudioContext` → `ScriptProcessorNode` at 16kHz mono.
- [x] 3.5 Recording pulse animation (CSS `@keyframes voice-input-pulse`).
- [x] 3.6 Live text overlay showing status (● Listening..., Transcribing..., error messages).
- [x] 3.7 Permission error handling: shows "Microphone permission denied" for `NotAllowedError`.
- [x] 3.8 Button disabled during `requesting-permission`, `loading-model`, and `transcribing` states.
- [x] 3.9 Cleanup on unmount: stops audio capture, clears hold timer.
- [x] 3.10 `onInsertText(text)` callback to inject transcribed text into CommandInput textarea.

## 4. Implement client-side parakeet.js transcription pipeline

- [x] 4.1 Dynamically import `parakeet.js` (`fromHub` or `fromUrls`) on first use — avoid bundling the 600MB model.
- [x] 4.2 Load Parakeet ONNX model (encoder, decoder, tokenizer) from HuggingFace CDN or custom URL.
- [x] 4.3 ONNX inference runs via parakeet.js backend (WebGPU / WASM), which manages Web Workers internally.
- [x] 4.4 Concatenate accumulated PCM chunks and transcribe via single-shot `model.transcribe()` — streaming transcriber was unstable (decoder stuck after first utterance, emitting only `.` placeholders).
- [x] 4.5 Return transcribed text via `onInsertText` callback.
- [x] 4.6 Handle model download progress and errors (network failure, out-of-memory).

## 5. Implement server-side Parakeet ONNX transcription

- [x] 5.1 Install `onnxruntime-node` as dependency of voice-input-plugin.
- [x] 5.2 Download Parakeet ONNX model files (encoder, decoder, tokenizer) from HuggingFace on server startup.
- [x] 5.3 Compute mel spectrogram via parakeet.js `JsPreprocessor` (128-bin NeMo-style features); the model expects 128 bins, not the originally planned 80-bin Slaney.
- [x] 5.4 Create ONNX inference sessions for encoder and decoder.
- [x] 5.5 Implement single-shot TDT frame-by-frame decoder loop: accumulate all chunks on `final: true`, then run encoder → per-frame token+duration argmax with LSTM state management. Per-chunk streaming abandoned — TDT models perform poorly on ~100ms inputs.
- [x] 5.6 Protocol: browser sends base64 PCM chunks via `voice_input_audio` WS message, server returns `voice_input_transcript`.
- [x] 5.7 Add OpenAI Whisper API fallback as alternative server engine.

## 6. Implement VoiceInputSettings component

- [x] 6.1 Render settings form in Settings > General tab.
- [x] 6.2 Mode dropdown: push-to-talk / toggle.
- [x] 6.3 Transcription engine dropdown: client / server.
- [x] 6.4 Server engine dropdown (conditional on server mode): parakeet-onnx / openai-whisper.
- [x] 6.5 HuggingFace model repo input (conditional on parakeet-onnx).
- [x] 6.6 OpenAI API key input (password, conditional on openai-whisper).
- [x] 6.7 Language input (BCP-47 code).
- [x] 6.8 VAD threshold range slider.
- [x] 6.9 Parakeet model URL input (conditional on client mode).
- [x] 6.10 Save button dispatches `plugin_config_write` with correct id and config.
- [x] 6.11 Reacts to external config updates (another client changing settings).

## 7. Server entry

- [x] 7.1 Register `voice_input_audio` browser handler for receiving PCM chunks.
- [x] 7.2 Broadcast `voice_input_transcript` messages back to subscribers.
- [x] 7.3 `/api/voice-input/health` REST route.
- [x] 7.4 No-op when `transcriptionEngine` is `"client"` (no server handlers registered).

## 8. Tests

- [x] 8.1 MicButton tests: rendering, push-to-talk hold/tap, toggle mode, permission denial, text insertion, disabled state, cleanup on unmount.
- [x] 8.2 VoiceInputSettings tests: rendering, default values, mode switch, engine switch, save dispatch, language update.
- [x] 8.3 All 17 tests pass with `PluginContextProvider` + `CurrentPluginLayer` wrapping.
- [x] 8.4 Add tests for client-side parakeet.js pipeline (mock ONNX runtime).
- [x] 8.5 Add tests for server-side transcription handler (mock onnxruntime-node).

## 9. Documentation

- [x] 9.1 Update `docs/file-index-plugins.md` with voice-input-plugin entries.
- [x] 9.2 Update `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/slot-taxonomy.md` with `command-input-action` slot.
- [x] 9.3 Add `AGENTS.md` Key Files entry for voice-input-plugin.
