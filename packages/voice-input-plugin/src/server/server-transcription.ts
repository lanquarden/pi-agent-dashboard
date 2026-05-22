/**
 * Server-side speech-to-text transcription engine.
 *
 * Supports two backends:
 *   - Parakeet ONNX (local, via onnxruntime-node)
 *   - OpenAI Whisper API (cloud, requires API key)
 *
 * Parakeet ONNX path:
 *   1. Download model files (encoder, decoder, tokenizer) from HuggingFace
 *   2. Mel spectrogram preprocessing via parakeet.js JsPreprocessor (128 bins)
 *   3. Encoder inference → per-frame TDT decoder loop → tokenizer → text
 */
// @ts-nocheck — onnxruntime-node types are loaded at runtime
import * as ort from "onnxruntime-node";
import { JsPreprocessor } from "parakeet.js";
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

interface ModelCache {
  encoderSession: ort.InferenceSession;
  joinerSession: ort.InferenceSession;
  tokenizer: { id2token: string[]; token2id: Record<string, number>; blankId: number };
}

// Model parameters for parakeet-tdt-0.6b-v3 (from parakeet.js MODELS config)
const N_MELS = 128;
const SUBSAMPLING = 8;
const PRED_HIDDEN = 640;
const PRED_LAYERS = 2;
const SAMPLE_RATE = 16000;

// ── Model management ─────────────────────────────────────────────────────────

let _modelCache: ModelCache | null = null;
let _modelLoadPromise: Promise<ModelCache> | null = null;

/**
 * Download Parakeet ONNX model files from HuggingFace and create ONNX sessions.
 * Uses int8 quantized models for speed and size.
 * Files are cached on disk at ~/.pi/dashboard/voice-input-models/.
 * Guarded against concurrent calls during first load.
 */
async function ensureParakeetModel(repoId: string): Promise<ModelCache> {
  if (_modelCache) return _modelCache;
  if (_modelLoadPromise) return _modelLoadPromise;

  _modelLoadPromise = (async () => {
    const modelDir = path.join(os.homedir(), ".pi", "dashboard", "voice-input-models", repoId.replace("/", "_"));
    await mkdir(modelDir, { recursive: true });

    const encoderPath = path.join(modelDir, "encoder-model.int8.onnx");
    const decoderPath = path.join(modelDir, "decoder_joint-model.int8.onnx");
    const vocabPath = path.join(modelDir, "vocab.txt");

    const baseUrl = `https://huggingface.co/${repoId}/resolve/main`;

    async function downloadIfMissing(filePath: string, url: string): Promise<void> {
      try { await readFile(filePath); } catch {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(filePath, buffer);
      }
    }

    await downloadIfMissing(encoderPath, `${baseUrl}/encoder-model.int8.onnx`);
    await downloadIfMissing(decoderPath, `${baseUrl}/decoder_joint-model.int8.onnx`);
    await downloadIfMissing(vocabPath, `${baseUrl}/vocab.txt`);

    const sessionOpts = { executionProviders: ["cpu"] };
    const [encoderSession, joinerSession] = await Promise.all([
      ort.InferenceSession.create(encoderPath, sessionOpts),
      ort.InferenceSession.create(decoderPath, sessionOpts),
    ]);

    // Load tokenizer vocabulary.
    // Format: "token_string id" — one entry per line.
    // IDs are non-sequential (e.g. "use 1163" at line 11 has id 1163).
    const vocabText = await readFile(vocabPath, "utf-8");
    const id2token: string[] = [];
    for (const line of vocabText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const lastSpace = trimmed.lastIndexOf(" ");
      if (lastSpace < 0) continue;
      const token = trimmed.slice(0, lastSpace);
      const id = parseInt(trimmed.slice(lastSpace + 1), 10);
      if (!isNaN(id)) id2token[id] = token;
    }
    const token2id: Record<string, number> = {};
    for (let i = 0; i < id2token.length; i++) {
      if (id2token[i] !== undefined) token2id[id2token[i]] = i;
    }
    const blankId = token2id["<blk>"] ?? 0;

    _modelCache = { encoderSession, joinerSession, tokenizer: { id2token, token2id, blankId } };
    return _modelCache;
  })();

  _modelLoadPromise = _modelLoadPromise.catch((err) => { _modelLoadPromise = null; throw err; });
  return _modelLoadPromise;
}

// ── TDT Decoding (based on parakeet.js _runCombinedStep + transcribe) ────────

/**
 * Transcribe PCM audio using Parakeet ONNX via TDT frame-by-frame decoding.
 *
 * Algorithm:
 *   1. JsPreprocessor computes 128-bin mel spectrogram
 *   2. Encoder: mel features → encoded frames [1, D, T_enc]
 *   3. For each encoded frame: run combined decoder step
 *      - Feed: encoder frame [1, D, 1] + previous token + LSTM states
 *      - Get: token logits + duration logits + new states
 *      - Emit non-blank tokens; advance frames by predicted duration
 */
export async function transcribeWithParakeet(
  samples: Float32Array,
  config: VoiceInputServerConfig,
): Promise<string> {
  const repoId = config.parakeetModelRepo || "ysdede/parakeet-tdt-0.6b-v3-onnx";
  const cache = await ensureParakeetModel(repoId);

  // 1. Mel spectrogram via parakeet.js JsPreprocessor (128 bins, NeMo-style)
  const preprocessor = new JsPreprocessor({ nMels: N_MELS, sampleRate: SAMPLE_RATE });
  const { features, length: nFrames } = preprocessor.process(samples);

  if (!features || !features.length || nFrames <= 0) return "";

  // 2. Encoder: audio_signal [1, nMels, nFrames] + length [1] → outputs [1, D, T_enc]
  const inputTensor = new ort.Tensor("float32", features, [1, N_MELS, nFrames]);
  const lenTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(nFrames)]), [1]);

  const encOut = await cache.encoderSession.run({
    audio_signal: inputTensor,
    length: lenTensor,
  });
  const enc = encOut["outputs"] ?? Object.values(encOut)[0];
  inputTensor.dispose?.();
  lenTensor.dispose?.();

  // Encoder output: [1, D, T_enc] → transpose to [T_enc, D]
  const [, D, Tenc] = enc.dims;
  const encData = enc.data as Float32Array;
  const transposed = new Float32Array(Tenc * D);
  for (let t = 0; t < Tenc; t++) {
    const tOff = t * D;
    for (let d = 0; d < D; d++) {
      transposed[tOff + d] = encData[d * Tenc + t];
    }
  }
  enc.dispose?.();

  // 3. Pre-allocate reusable tensors for the decoder loop
  const encFrameBuf = new Float32Array(D);
  const encFrameTensor = new ort.Tensor("float32", encFrameBuf, [1, D, 1]);
  const targetIdArray = new Int32Array(1);
  const targetTensor = new ort.Tensor("int32", targetIdArray, [1, 1]);
  const targetLenArray = new Int32Array([1]);
  const targetLenTensor = new ort.Tensor("int32", targetLenArray, [1]);

  // Zero LSTM states [numLayers, 1, hidden] = [2, 1, 640]
  const stateSize = PRED_LAYERS * 1 * PRED_HIDDEN;
  const stateDims = [PRED_LAYERS, 1, PRED_HIDDEN];
  let curState1 = new ort.Tensor("float32", new Float32Array(stateSize), stateDims);
  let curState2 = new ort.Tensor("float32", new Float32Array(stateSize), stateDims);

  const vocabSize = cache.tokenizer.id2token.length;
  const blankId = cache.tokenizer.blankId;
  const tokenIds: number[] = [];

  // 4. Decode frame-by-frame
  let previousToken = blankId;
  let t = 0;
  while (t < Tenc) {
    // Copy current encoder frame into reusable tensor
    const frameStart = t * D;
    encFrameBuf.set(transposed.subarray(frameStart, frameStart + D));

    // Set target to previous token
    targetIdArray[0] = previousToken;

    const feeds: Record<string, ort.Tensor> = {
      encoder_outputs: encFrameTensor,
      targets: targetTensor,
      target_length: targetLenTensor,
      input_states_1: curState1,
      input_states_2: curState2,
    };

    const out = await cache.joinerSession.run(feeds);
    const logits = out["outputs"];
    const nextState1 = out["output_states_1"];
    const nextState2 = out["output_states_2"];

    if (!logits || !logits.data) break;

    const data = logits.data as Float32Array;
    // logits shape: [1, 1, vocabSize + durSize]
    // First vocabSize entries = token logits, rest = duration logits
    const durSize = data.length - vocabSize;

    // Token argmax
    let maxTokenId = blankId;
    let maxTokenVal = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      if (data[v] > maxTokenVal) { maxTokenVal = data[v]; maxTokenId = v; }
    }

    // Duration argmax
    let step = 0;
    if (durSize > 0) {
      let maxDurVal = -Infinity;
      for (let d = 0; d < durSize; d++) {
        if (data[vocabSize + d] > maxDurVal) { maxDurVal = data[vocabSize + d]; step = d; }
      }
    }

    // Emit non-blank tokens
    if (maxTokenId !== blankId) {
      tokenIds.push(maxTokenId);
      previousToken = maxTokenId;

      // Update LSTM states only on non-blank (matching Python reference)
      if (nextState1) {
        curState1.dispose?.();
        curState2.dispose?.();
        curState1 = nextState1;
        curState2 = nextState2;
      }
    }

    logits.dispose?.();

    // Advance frames by predicted duration (minimum 1 to avoid infinite loop)
    t += Math.max(1, step);
  }

  // 5. Cleanup remaining tensors
  curState1.dispose?.();
  curState2.dispose?.();
  if (curState1 !== encFrameTensor) encFrameTensor.dispose?.();
  targetTensor.dispose?.();
  targetLenTensor.dispose?.();

  // 6. Decode tokens to text
  let text = "";
  for (const tid of tokenIds) {
    const token = cache.tokenizer.id2token[tid] || "";
    if (token === "<eos>" || token === "</s>") break;
    text += token;
  }
  // Replace word boundary marker with space
  text = text.replace(/▁/g, " ").trim();

  return text;
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

// ── OpenAI Whisper API ───────────────────────────────────────────────────────

/**
 * Transcribe audio using OpenAI Whisper API.
 */
export async function transcribeWithWhisper(
  base64Chunk: string,
  config: VoiceInputServerConfig,
): Promise<string> {
  if (!config.openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }

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

function createWavHeader(numSamples: number): Buffer {
  const dataSize = numSamples * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}
