## ADDED Requirements

### Requirement: Plugin manifest and discovery

The plugin SHALL declare a `pi-dashboard-plugin` manifest in `packages/voice-input-plugin/package.json` with id `"voice-input"`, display name `"Voice Input"`, priority `200`, and claims for `command-input-action` (component: `MicButton`) and `settings-section` (component: `VoiceInputSettings`, tab: `general`). The Vite plugin SHALL auto-discover it from `packages/*/package.json`.

#### Scenario: Plugin appears in build output

- **GIVEN** the monorepo at build time
- **WHEN** `npm run build` executes
- **THEN** the plugin-loader log SHALL include `voice-input` in the discovered plugin list.

#### Scenario: Plugin registry includes correct claims

- **GIVEN** the generated `plugin-registry.tsx`
- **WHEN** the registry is inspected
- **THEN** it SHALL contain a `RegistryEntry` for `voice-input` with claims for both `command-input-action` and `settings-section`.

### Requirement: Push-to-talk recording mode

When config `mode` is `"push-to-talk"`, the MicButton SHALL start recording on `pointerDown` after a 200ms hold threshold, and SHALL stop recording and trigger transcription on `pointerUp`. Quick taps (<200ms) SHALL NOT start recording.

#### Scenario: Hold triggers recording

- **GIVEN** mode is `"push-to-talk"` and microphone permission is granted
- **WHEN** the user presses and holds the mic button for >200ms
- **THEN** recording SHALL start and the button SHALL show a listening indicator (pulsing red ring).

#### Scenario: Quick tap does not trigger recording

- **GIVEN** mode is `"push-to-talk"`
- **WHEN** the user presses and releases the mic button within 200ms
- **THEN** recording SHALL NOT start.

#### Scenario: Release stops recording and transcribes

- **GIVEN** mode is `"push-to-talk"` and recording is active
- **WHEN** the user releases the mic button
- **THEN** recording SHALL stop, transcription SHALL begin, and the result SHALL be inserted via `onInsertText`.

### Requirement: Toggle recording mode

When config `mode` is `"toggle"`, the MicButton SHALL toggle recording on `onClick`. The first click starts recording, the second click stops and transcribes.

#### Scenario: Click starts recording

- **GIVEN** mode is `"toggle"` and microphone permission is granted
- **WHEN** the user clicks the mic button
- **THEN** recording SHALL start and the button SHALL show a listening indicator.

#### Scenario: Second click stops recording

- **GIVEN** mode is `"toggle"` and recording is active
- **WHEN** the user clicks the mic button again
- **THEN** recording SHALL stop, transcription SHALL begin, and the result SHALL be inserted via `onInsertText`.

### Requirement: Microphone permission handling

The MicButton SHALL request microphone access via `navigator.mediaDevices.getUserMedia({ audio: ... })` when recording starts. If permission is denied, it SHALL display the message "Microphone permission denied" and enter an error state.

#### Scenario: Permission denied shows error

- **GIVEN** the user denies microphone permission
- **WHEN** recording is attempted
- **THEN** the live text SHALL show "Microphone permission denied" and the button SHALL indicate error state (amber background).

### Requirement: Audio capture pipeline

Audio SHALL be captured at 16kHz mono with echo cancellation and noise suppression enabled. The pipeline SHALL use `getUserMedia` → `AudioContext` → `ScriptProcessorNode` with buffer size 4096. On stop, all tracks and the AudioContext SHALL be closed.

#### Scenario: Audio capture starts and stops cleanly

- **GIVEN** microphone permission is granted
- **WHEN** recording starts and then stops
- **THEN** the MediaStream tracks SHALL be stopped and the AudioContext SHALL be closed.

### Requirement: Client-side transcription engine

When config `transcriptionEngine` is `"client"`, the plugin SHALL load `parakeet.js` dynamically (not bundled) and run ONNX inference in a Web Worker. The Parakeet TDT 0.6B v3 ONNX model SHALL be loaded from the configured `parakeetModelUrl` or the default HuggingFace CDN.

#### Scenario: Model loads on first use

- **GIVEN** transcription engine is `"client"` and this is the first recording
- **WHEN** the user starts recording
- **THEN** the parakeet.js model SHALL be downloaded and loaded before audio capture begins.

#### Scenario: Subsequent recordings reuse loaded model

- **GIVEN** the parakeet.js model is already loaded
- **WHEN** the user starts a second recording
- **THEN** the model SHALL NOT be re-downloaded; inference SHALL begin immediately.

### Requirement: Server-side transcription engine

When config `transcriptionEngine` is `"server"`, the plugin SHALL capture audio in the browser, base64-encode PCM chunks, and send them to the dashboard server via `voice_input_audio` WebSocket messages. The server SHALL run Parakeet ONNX inference via `onnxruntime-node` (default) or call the OpenAI Whisper API (fallback), and broadcast `voice_input_transcript` messages back.

#### Scenario: Audio chunks streamed to server

- **GIVEN** transcription engine is `"server"` and `serverEngine` is `"parakeet-onnx"`
- **WHEN** the user records audio
- **THEN** PCM chunks SHALL be base64-encoded and sent as `voice_input_audio` messages to the server.

#### Scenario: Server returns transcription

- **GIVEN** the server receives a `voice_input_audio` message with `final: true`
- **WHEN** transcription completes
- **THEN** a `voice_input_transcript` message SHALL be broadcast to all subscribed clients with the transcribed text.

#### Scenario: OpenAI Whisper fallback

- **GIVEN** `serverEngine` is `"openai-whisper"` and an API key is configured
- **WHEN** a `voice_input_audio` message with `final: true` is received
- **THEN** the server SHALL call the OpenAI Audio Transcription API and broadcast the result.

### Requirement: Settings form

The `VoiceInputSettings` component SHALL render in the Settings > General tab. It SHALL expose all config fields defined in `configSchema.json`: mode, transcriptionEngine, language, serverEngine, openaiApiKey, parakeetModelRepo, vadThreshold, and parakeetModelUrl. It SHALL dispatch `plugin_config_write` on save.

#### Scenario: Server engine fields appear conditionally

- **GIVEN** `transcriptionEngine` is `"client"`
- **WHEN** the settings form renders
- **THEN** server engine fields (serverEngine, openaiApiKey, parakeetModelRepo) SHALL NOT be visible.

#### Scenario: Server engine fields appear when server mode selected

- **GIVEN** `transcriptionEngine` is switched to `"server"`
- **WHEN** the settings form re-renders
- **THEN** the server engine dropdown and associated fields SHALL be visible.

#### Scenario: Save persists config

- **GIVEN** the user changes `language` to `"de"` and clicks Save
- **WHEN** the save dispatches
- **THEN** a `plugin_config_write` message SHALL be sent with `id: "voice-input"` and `config.language: "de"`.

### Requirement: Server entry self-registers

The server entry SHALL export a default `registerPlugin(ctx: ServerPluginContext)` function. When `transcriptionEngine` is `"client"`, it SHALL log that no handlers were registered and return. When `transcriptionEngine` is `"server"`, it SHALL register a `voice_input_audio` browser handler and a `/api/voice-input/health` REST route.

#### Scenario: Client mode skips server handlers

- **GIVEN** config `transcriptionEngine` is `"client"`
- **WHEN** the server entry loads
- **THEN** no browser handlers SHALL be registered and the health route SHALL NOT be added.

#### Scenario: Server mode registers handlers

- **GIVEN** config `transcriptionEngine` is `"server"`
- **WHEN** the server entry loads
- **THEN** the `voice_input_audio` handler and `/api/voice-input/health` route SHALL be registered.

### Requirement: Cleanup on unmount

The MicButton SHALL clean up all resources on unmount: stop any active audio capture, clear the hold timer, and close the AudioContext.

#### Scenario: Unmount during recording does not leak

- **GIVEN** recording is active
- **WHEN** the MicButton component unmounts (e.g. session switch)
- **THEN** the MediaStream tracks SHALL be stopped and the AudioContext SHALL be closed without throwing.
