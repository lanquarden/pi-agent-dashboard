## Context

The dashboard plugin system exposes 10 React-claimable slots for extending the UI. However, the `CommandInput` component — the primary text input for sending prompts — has no extension point. Plugins cannot add buttons or controls to the input area.

Voice input is the motivating use case, but the slot is general-purpose: any plugin could use it for emoji pickers, snippet inserters, or other input-area actions.

The slot taxonomy is frozen; adding a new slot requires an OpenSpec change against `dashboard-shell-slots`.

## Goals / Non-Goals

**Goals**

- Add a `command-input-action` slot rendered inline in the CommandInput button row (before Send/Stop).
- Session-scoped (receives `session` and `pluginContext`) so plugins can target the active session.
- `onInsertText` callback so plugin components can inject text into the textarea without needing internal access to CommandInput state.
- Multiplicity: many — multiple plugins can contribute buttons simultaneously.
- Follow existing slot consumer patterns (SlotErrorBoundary, CurrentPluginLayer, intent rendering).

**Non-Goals**

- Plugin components modifying CommandInput internals directly. The `onInsertText` callback is the sole insertion API.
- Audio capture, speech-to-text, or any voice-specific logic — that belongs in the plugin.
- Modifying autocomplete behavior.
- A slot for the textarea itself (e.g. inline suggestions).

## Slot design

```
┌─ CommandInput ──────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐   │
│  │ textarea (auto-resize, autocomplete, image paste)     │   │
│  └──────────────────────────────────────────────────────┘   │
│  [MicBtn] [EmojiBtn]  ...plugin buttons...  [Send] [Stop]   │
│   ▲                                              ▲          │
│   └── command-input-action slot ─────────────────┘          │
│        (many, session-scoped, react-only)                   │
└─────────────────────────────────────────────────────────────┘
```

Slot props (from `SlotPropsMap`):

```ts
"command-input-action": {
  session: DashboardSession;
  pluginContext: AnyPluginContext;
  onInsertText: (text: string) => void;
}
```

The consumer (`CommandInputActionSlot`) renders claims in priority order. Each claim's component receives the typed props. Components call `onInsertText(text)` to append text to the textarea draft — this is wired to CommandInput's internal `setText` function.

## Transcription architecture

The voice-input plugin supports two transcription paths sharing the same Parakeet TDT 0.6B v3 ONNX model:

```
┌─ Client mode ───────────────────────────────────┐
│  getUserMedia → AudioContext → PCM chunks        │
│       ↓                                          │
│  Web Worker: onnxruntime-web                     │
│       ↓                                          │
│  parakeet.js: encoder (WebGPU) + decoder (WASM)  │
│       ↓                                          │
│  tokenizer → text → onInsertText()               │
└──────────────────────────────────────────────────┘

┌─ Server mode ───────────────────────────────────┐
│  getUserMedia → AudioContext → PCM chunks        │
│       ↓                                          │
│  base64 encode → voice_input_audio WS msg        │
│       ↓                                          │
│  Dashboard server: onnxruntime-node              │
│       ↓                                          │
│  encoder (CPU/CUDA) + decoder → text             │
│       ↓                                          │
│  voice_input_transcript WS msg → onInsertText()  │
└──────────────────────────────────────────────────┘
```

Both paths use the same ONNX model files from HuggingFace (`ysdede/parakeet-tdt-0.6b-v3-onnx`). Server mode also supports OpenAI Whisper API as a fallback.

**Streaming vs single-shot**: The original design used streaming transcription (per-chunk `processChunk` → incremental decoder state). This was abandoned in favor of single-shot on both paths:
- **Client**: The parakeet streaming transcriber's decoder state converged to a blank/eos token on early chunks, emitting only `.` placeholders for all subsequent audio. Single-shot `model.transcribe(fullAudio)` lets the model see complete context and produces accurate multi-sentence output.
- **Server**: TDT models need more than ~100ms of audio to produce meaningful tokens. The server accumulates all base64 PCM chunks in a `pendingRecordings` map and runs the full TDT frame-by-frame decoder loop once on `final: true`.

### Why not whisper.cpp

whisper.cpp uses GGML-format models — a different model family. Using Parakeet ONNX on both sides means:
- One model download works for both client and server
- Consistent accuracy between paths
- `onnxruntime-node` is an npm install (no binary compilation)
- Same preprocessing pipeline (mel spectrogram) shared between implementations

### Plugin settings schema

```json
{
  "mode": "push-to-talk" | "toggle",
  "transcriptionEngine": "client" | "server",
  "language": "en",
  "serverEngine": "parakeet-onnx" | "openai-whisper",
  "openaiApiKey": "",
  "parakeetModelRepo": "ysdede/parakeet-tdt-0.6b-v3-onnx",
  "vadThreshold": 0.3,
  "parakeetModelUrl": ""
}
```

## Recording modes

### Push-to-talk

```
pointerDown ──[200ms hold]──→ startRecording ──→ "● Listening..."
pointerUp ──────────────────→ stopRecording ──→ transcribe → onInsertText
```

Quick taps (<200ms) are ignored to prevent accidental triggers. The 200ms threshold is hardcoded for v1 — could become configurable if user feedback warrants.

### Toggle

```
click ──→ startRecording ──→ "● Listening..."
click ──→ stopRecording ──→ transcribe → onInsertText
```

Error state ("Microphone permission denied", etc.) resets to idle after 5s or on next interaction.

## File structure

```
packages/voice-input-plugin/
├── package.json           # pi-dashboard-plugin manifest, deps
├── configSchema.json      # JSON Schema 7
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── client.tsx          # MicButton + VoiceInputSettings
│   ├── server/
│   │   └── index.ts        # ServerPluginContext entry
│   └── __tests__/
│       ├── MicButton.test.tsx
│       └── VoiceInputSettings.test.tsx
```

## Protocol (server mode)

Browser → Server:
```ts
{ type: "voice_input_audio", sessionId: string, chunk?: string, final?: boolean }
```

Server → Browser:
```ts
{ type: "voice_input_transcript", sessionId: string, text: string, partial: boolean }
```

## Dependencies

- `@blackbelt-technology/dashboard-plugin-runtime` (peer, for plugin context hooks)
- `@blackbelt-technology/pi-dashboard-shared` (peer, for slot types)
- `@mdi/js` + `@mdi/react` (mic icons)
- `parakeet.js` (client-side, dynamic import — not bundled)
- `onnxruntime-node` (server-side, for Parakeet ONNX inference)
