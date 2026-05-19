/**
 * Server-side speech-to-text transcription engine.
 *
 * Supports two backends:
 *   - Parakeet ONNX (local, via onnxruntime-node)
 *   - OpenAI Whisper API (cloud, requires API key)
 *
 * Parakeet ONNX path:
 *   1. Download model files (encoder, decoder, tokenizer) from HuggingFace
 *   2. Mel spectrogram preprocessing (pure JS, matching parakeet.js mel.js)
 *   3. Encoder inference → decoder inference with state handoff → tokenizer → text
 *
 * The mel preprocessing is a port of the parakeet.js JsPreprocessor, keeping the
 * same Slaney mel filterbank, Hann window STFT, and CMVN normalization.
 */
// @ts-nocheck — onnxruntime-node types are loaded at runtime
import * as ort from "onnxruntime-node";
import * as ort from "onnxruntime-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VoiceInputServerConfig {
  mode: "push-to-talk" | "toggle";
  transcriptionEngine: "client" | "server";
  language: string;
  serverEngine: "parakeet-onnx" | "openai-whisper";
  openaiApiKey: string;
  parakeetModelRepo: string;
  vadThreshold: number;
  parakeetModelUrl: string;
}

interface StreamingDecoderState {
  previousState: ort.InferenceSession.OnnxValueMapType | null;
  timeOffset: number;
  totalWords: Array<{ text: string; start_time?: number; end_time?: number }>;
}

// ── Mel spectrogram constants (matching parakeet.js mel.js) ──────────────────

const SAMPLE_RATE = 16000;
const N_FFT = 512;
const WIN_LENGTH = 400;
const HOP_LENGTH = 160;
const PREEMPH = 0.97;
const LOG_ZERO_GUARD = 2 ** -24;
const N_FREQ_BINS = (N_FFT >> 1) + 1; // 257
const N_MELS = 80;

// ── Slaney Mel Scale ─────────────────────────────────────────────────────────

const F_SP = 200.0 / 3;
const MIN_LOG_HZ = 1000.0;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27.0;

function hzToMel(freq: number): number {
  return freq >= MIN_LOG_HZ
    ? MIN_LOG_MEL + Math.log(freq / MIN_LOG_HZ) / LOG_STEP
    : freq / F_SP;
}

function melToHz(mel: number): number {
  return mel >= MIN_LOG_MEL
    ? MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))
    : mel * F_SP;
}

// ── Cached filterbank ────────────────────────────────────────────────────────

let _melFilterbank: Float32Array | null = null;

function getMelFilterbank(): Float32Array {
  if (_melFilterbank) return _melFilterbank;

  const fMin = 0;
  const fMax = SAMPLE_RATE / 2;
  const nMels = N_MELS;

  // Linearly spaced frequency bins
  const allFreqs = new Float64Array(N_FREQ_BINS);
  for (let i = 0; i < N_FREQ_BINS; i++) {
    allFreqs[i] = (fMax * i) / (N_FREQ_BINS - 1);
  }

  // Mel-spaced center frequencies
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const nPoints = nMels + 2;
  const fPts = new Float64Array(nPoints);
  for (let i = 0; i < nPoints; i++) {
    fPts[i] = melToHz(melMin + ((melMax - melMin) * i) / (nPoints - 1));
  }

  // Build triangular filterbank
  const fb = new Float32Array(nMels * N_FREQ_BINS);
  for (let m = 0; m < nMels; m++) {
    const left = fPts[m];
    const center = fPts[m + 1];
    const right = fPts[m + 2];
    const denomLeft = center - left;
    const denomRight = right - center;

    for (let k = 0; k < N_FREQ_BINS; k++) {
      const freq = allFreqs[k];
      if (freq >= left && freq <= center && denomLeft > 0) {
        fb[m * N_FREQ_BINS + k] = (freq - left) / denomLeft;
      } else if (freq > center && freq <= right && denomRight > 0) {
        fb[m * N_FREQ_BINS + k] = (right - freq) / denomRight;
      }
    }
  }

  // Slaney normalization: each filter summed to 1
  for (let m = 0; m < nMels; m++) {
    let sum = 0;
    for (let k = 0; k < N_FREQ_BINS; k++) {
      sum += fb[m * N_FREQ_BINS + k];
    }
    if (sum > 0) {
      for (let k = 0; k < N_FREQ_BINS; k++) {
        fb[m * N_FREQ_BINS + k] /= sum;
      }
    }
  }

  _melFilterbank = fb;
  return fb;
}

// ── Hann window (cached) ─────────────────────────────────────────────────────

let _hannWindow: Float64Array | null = null;

function getHannWindow(): Float64Array {
  if (_hannWindow) return _hannWindow;
  const win = new Float64Array(WIN_LENGTH);
  for (let i = 0; i < WIN_LENGTH; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN_LENGTH - 1)));
  }
  _hannWindow = win;
  return win;
}

// ── Real FFT via N/2-point complex FFT (matching parakeet.js) ────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Cooley-Tukey
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const cos = Math.cos(angle * j);
        const sin = Math.sin(angle * j);
        const tr = re[i + j + half] * cos - im[i + j + half] * sin;
        const ti = re[i + j + half] * sin + im[i + j + half] * cos;
        re[i + j + half] = re[i + j] - tr;
        im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr;
        im[i + j] += ti;
      }
    }
  }
}

// ── Mel spectrogram computation ──────────────────────────────────────────────

/**
 * Compute log-mel spectrogram from 16kHz mono PCM audio.
 * Matches the parakeet.js JsPreprocessor output exactly.
 *
 * Pipeline:
 *   1. Pre-emphasis: x[n] -= 0.97 * x[n-1]
 *   2. Zero-pad: N_FFT/2 = 256 samples each side
 *   3. STFT with Hann window, hop_length=160
 *   4. Power spectrum: |real|² + |imag|²
 *   5. Mel filterbank MatMul
 *   6. Log(mel + 2^-24)
 *   7. Per-feature mean/variance normalization
 *
 * @returns Float32Array [nFrames, N_MELS] row-major
 */
export function computeMelSpectrogram(audio: Float32Array): Float32Array {
  const samples = new Float64Array(audio.length);

  // Pre-emphasis
  samples[0] = audio[0];
  for (let i = 1; i < audio.length; i++) {
    samples[i] = audio[i] - PREEMPH * audio[i - 1];
  }

  // Zero-pad: 256 samples each side
  const padLen = N_FFT >> 1; // 256
  const hopLen = HOP_LENGTH; // 160
  const nFrames = Math.floor((samples.length - WIN_LENGTH) / hopLen) + 1;

  const hann = getHannWindow();
  const filterbank = getMelFilterbank();
  const nMels = N_MELS;

  // Guard against audio too short for even one frame
  if (nFrames <= 0) {
    return new Float32Array(0);
  }

  // STFT with zero-padding
  const spectrogram = new Float32Array(nFrames * nMels);

  for (let frame = 0; frame < nFrames; frame++) {
    const start = frame * hopLen;

    // Window + zero-pad to N_FFT
    const re = new Float64Array(N_FFT);
    const im = new Float64Array(N_FFT); // all zeros

    for (let i = 0; i < WIN_LENGTH; i++) {
      const sampleIdx = start + i - padLen;
      if (sampleIdx >= 0 && sampleIdx < samples.length) {
        re[i + padLen] = samples[sampleIdx] * hann[i];
      }
    }

    // Real FFT via complex FFT of half size
    // Pack real sequence into N_FFT/2 complex
    const halfN = N_FFT >> 1;
    const cre = new Float64Array(halfN);
    const cim = new Float64Array(halfN);
    for (let i = 0; i < halfN; i++) {
      cre[i] = re[2 * i];
      cim[i] = re[2 * i + 1];
    }
    fft(cre, cim);

    // Reconstruct N_FFT-point spectrum from half-size FFT
    // DC and Nyquist
    const power = new Float32Array(N_FREQ_BINS);
    power[0] = (cre[0] + cim[0]) * (cre[0] + cim[0]) + 0; // DC
    power[N_FREQ_BINS - 1] = (cre[0] - cim[0]) * (cre[0] - cim[0]) + 0; // Nyquist

    for (let k = 1; k < halfN; k++) {
      const r = (cre[k] + cre[halfN - k]) * 0.5;
      const i = (cim[k] - cim[halfN - k]) * 0.5;
      const sr = (cim[k] + cim[halfN - k]) * 0.5;
      const si = (cre[halfN - k] - cre[k]) * 0.5;
      const cos = Math.cos((Math.PI * k) / halfN);
      const sin = Math.sin((Math.PI * k) / halfN);
      const real = r + sr * cos - si * sin;
      const imag = i + sr * sin + si * cos;
      power[k] = real * real + imag * imag;
    }

    // Mel filterbank multiply
    const melFrame = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let acc = 0;
      for (let k = 0; k < N_FREQ_BINS; k++) {
        acc += power[k] * filterbank[m * N_FREQ_BINS + k];
      }
      melFrame[m] = acc;
    }

    // Log
    for (let m = 0; m < nMels; m++) {
      melFrame[m] = Math.log(Math.max(melFrame[m], 0) + LOG_ZERO_GUARD);
    }

    // Store row
    const offset = frame * nMels;
    for (let m = 0; m < nMels; m++) {
      spectrogram[offset + m] = melFrame[m];
    }
  }

  // Per-feature mean/std normalization (Bessel corrected)
  for (let m = 0; m < nMels; m++) {
    let sum = 0;
    let validFrames = 0;
    for (let f = 0; f < nFrames; f++) {
      sum += spectrogram[f * nMels + m];
      validFrames++;
    }
    if (validFrames < 2) continue;
    const mean = sum / validFrames;
    let varSum = 0;
    for (let f = 0; f < nFrames; f++) {
      const diff = spectrogram[f * nMels + m] - mean;
      varSum += diff * diff;
    }
    const std = Math.sqrt(varSum / (validFrames - 1));
    if (std > 0) {
      for (let f = 0; f < nFrames; f++) {
        spectrogram[f * nMels + m] = (spectrogram[f * nMels + m] - mean) / std;
      }
    }
  }

  return spectrogram;
}

// ── Model management ─────────────────────────────────────────────────────────

interface ModelCache {
  encoderSession: ort.InferenceSession | null;
  decoderSession: ort.InferenceSession | null;
  tokenizerVocab: string[] | null;
  blankId: number;
}

let _modelCache: ModelCache | null = null;

/**
 * Download Parakeet ONNX model files from HuggingFace and create ONNX sessions.
 * Files are cached on disk at ~/.pi/dashboard/voice-input-models/.
 */
async function ensureParakeetModel(repoId: string): Promise<ModelCache> {
  if (_modelCache) return _modelCache;

  const modelDir = path.join(os.homedir(), ".pi", "dashboard", "voice-input-models", repoId.replace("/", "_"));
  await mkdir(modelDir, { recursive: true });

  const encoderPath = path.join(modelDir, "encoder-model.onnx");
  const decoderPath = path.join(modelDir, "decoder_joint-model.onnx");
  const vocabPath = path.join(modelDir, "vocab.txt");

  // Download if not cached
  const baseUrl = `https://huggingface.co/${repoId}/resolve/main`;

  async function downloadIfMissing(filePath: string, url: string): Promise<void> {
    try {
      await readFile(filePath);
    } catch {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
    }
  }

  await downloadIfMissing(encoderPath, `${baseUrl}/encoder-model.onnx`);
  await downloadIfMissing(decoderPath, `${baseUrl}/decoder_joint-model.int8.onnx`);
  await downloadIfMissing(vocabPath, `${baseUrl}/vocab.txt`);

  // Create ONNX sessions
  const encoderSession = await ort.InferenceSession.create(encoderPath, {
    executionProviders: ["cpu"],
  });
  const decoderSession = await ort.InferenceSession.create(decoderPath, {
    executionProviders: ["cpu"],
  });

  // Load tokenizer vocabulary
  const vocabText = await readFile(vocabPath, "utf-8");
  const vocab = vocabText.split("\n").filter((line) => line.trim().length > 0);

  _modelCache = {
    encoderSession,
    decoderSession,
    tokenizerVocab: vocab,
    blankId: vocab.indexOf("<blank>") >= 0 ? vocab.indexOf("<blank>") : 0,
  };

  return _modelCache;
}

// ── Streaming decoder state ──────────────────────────────────────────────────

const _decoderStates = new Map<string, StreamingDecoderState>();

function getDecoderState(sessionId: string): StreamingDecoderState {
  let state = _decoderStates.get(sessionId);
  if (!state) {
    state = { previousState: null, timeOffset: 0, totalWords: [] };
    _decoderStates.set(sessionId, state);
  }
  return state;
}

function resetDecoderState(sessionId: string): void {
  _decoderStates.delete(sessionId);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the Parakeet ONNX transcription engine.
 * Downloads model files from HuggingFace on first call.
 */
export async function initParakeetEngine(config: VoiceInputServerConfig): Promise<void> {
  const repoId = config.parakeetModelRepo || "ysdede/parakeet-tdt-0.6b-v3-onnx";
  await ensureParakeetModel(repoId);
}

/**
 * Transcribe base64-encoded PCM audio using Parakeet ONNX.
 *
 * @param sessionId - Session identifier for streaming state tracking
 * @param base64Chunk - Base64-encoded Float32Array PCM (16kHz mono)
 * @param isFinal - Whether this is the final chunk
 * @param config - Plugin configuration
 * @returns Transcribed text
 */
export async function transcribeWithParakeet(
  sessionId: string,
  base64Chunk: string,
  isFinal: boolean,
  config: VoiceInputServerConfig,
): Promise<string> {
  // Decode base64 PCM
  const buffer = Buffer.from(base64Chunk, "base64");
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

  // Compute mel spectrogram
  const mel = computeMelSpectrogram(samples);

  const repoId = config.parakeetModelRepo || "ysdede/parakeet-tdt-0.6b-v3-onnx";
  const cache = await ensureParakeetModel(repoId);
  const state = getDecoderState(sessionId);

  // Encoder inference
  // Input shape: [1, nMels, nFrames]
  const melTensor = new ort.Tensor("float32", mel, [1, N_MELS, mel.length / N_MELS]);
  const encoderFeeds: Record<string, ort.Tensor> = {};
  encoderFeeds[cache.encoderSession.inputNames[0]] = melTensor;
  const encoderResults = await cache.encoderSession.run(encoderFeeds);

  // Decoder inference
  const decoderFeeds: Record<string, ort.Tensor> = {};

  // Map encoder output to decoder input
  const encoderOutputName = cache.encoderSession.outputNames[0];
  const decoderInputName = cache.decoderSession.inputNames.find(
    (name: string) => name !== "previous_state_in",
  ) || cache.decoderSession.inputNames[0];

  decoderFeeds[decoderInputName] = encoderResults[encoderOutputName];

  // Pass previous decoder state if available
  if (state.previousState) {
    for (const name of cache.decoderSession.inputNames) {
      if (name.includes("previous_state") || name.includes("state_in")) {
        if (state.previousState[name]) {
          decoderFeeds[name] = state.previousState[name];
        }
      }
    }
  }

  const decoderResults = await cache.decoderSession.run(decoderFeeds);

  // Extract tokens from decoder output
  const outputName = cache.decoderSession.outputNames.find(
    (name: string) => !name.includes("state"),
  ) || cache.decoderSession.outputNames[0];

  const logits = decoderResults[outputName];
  const tokenIds: number[] = [];

  if (logits) {
    const data = logits.data as Float32Array;
    const vocabSize = cache.tokenizerVocab!.length;
    const seqLen = data.length / vocabSize;

    for (let t = 0; t < seqLen; t++) {
      let maxIdx = 0;
      let maxVal = data[t * vocabSize];
      for (let v = 1; v < vocabSize; v++) {
        if (data[t * vocabSize + v] > maxVal) {
          maxVal = data[t * vocabSize + v];
          maxIdx = v;
        }
      }
      if (maxIdx !== cache.blankId) {
        tokenIds.push(maxIdx);
      }
    }
  }

  // Update decoder state for next chunk
  const nextState: ort.InferenceSession.OnnxValueMapType = {};
  for (const name of cache.decoderSession.outputNames) {
    if (name.includes("state") || name.includes("previous_state_out")) {
      nextState[name] = decoderResults[name];
    }
  }
  state.previousState = Object.keys(nextState).length > 0 ? nextState : null;

  // Decode tokens to text
  const text = tokenIds
    .map((id) => cache.tokenizerVocab![id] || "")
    .join("")
    .replace(/▁/g, " ")
    .trim();

  if (isFinal) {
    resetDecoderState(sessionId);
  }

  return text;
}

/**
 * Transcribe audio using OpenAI Whisper API.
 *
 * @param base64Chunk - Base64-encoded raw PCM (not WAV — converted here)
 * @param config - Plugin configuration (needs openaiApiKey)
 * @returns Transcribed text
 */
export async function transcribeWithWhisper(
  base64Chunk: string,
  config: VoiceInputServerConfig,
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }

  // Decode base64 PCM → Float32Array → WAV buffer
  const pcmBuffer = Buffer.from(base64Chunk, "base64");
  const samples = new Float32Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 4);

  // Convert to 16-bit PCM WAV
  const wavHeader = createWavHeader(samples.length);
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const wavBuffer = Buffer.concat([wavHeader, Buffer.from(pcm16.buffer)]);

  // OpenAI Audio Transcription API
  const formData = new FormData();
  formData.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
  formData.append("model", "whisper-1");
  if (config.language && config.language !== "en") {
    formData.append("language", config.language);
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenAI Whisper API error ${response.status}: ${errBody}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text || "";
}

/**
 * WAV header for 16-bit mono PCM.
 */
function createWavHeader(numSamples: number): Buffer {
  const dataSize = numSamples * 2; // 16-bit = 2 bytes/sample
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}
