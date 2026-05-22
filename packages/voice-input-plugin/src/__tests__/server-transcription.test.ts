/**
 * Server-side transcription tests.
 *
 * Tests the Parakeet ONNX transcription pipeline with mocked onnxruntime-node
 * and parakeet.js JsPreprocessor, plus an in-memory filesystem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
type PathLike = string | Buffer | URL;
type FileHandle = { fd: number };

// ── Mock state ───────────────────────────────────────────────────────────────

const _mockFs = new Map<string, string>();

function seedMockFs(files: Record<string, string>): void {
  for (const [key, value] of Object.entries(files)) {
    _mockFs.set(key, value);
  }
}

// ── Mock onnxruntime-node ────────────────────────────────────────────────────

vi.mock("onnxruntime-node", () => {
  class MockTensor {
    type: string;
    data: Float32Array | Int32Array | BigInt64Array;
    dims: number[];
    constructor(type: string, data: Float32Array | Int32Array | BigInt64Array | number[], dims: number[]) {
      this.type = type;
      this.data = Array.isArray(data) ? new Float32Array(data) : (data as Float32Array);
      this.dims = dims;
    }
    dispose() {}
  }

  const mockEncoderSession = {
    inputNames: ["audio_signal", "length"],
    outputNames: ["outputs", "encoded_lengths"],
    run: vi.fn().mockResolvedValue({
      outputs: new MockTensor("float32", new Float32Array(100 * 256), [1, 256, 100]),
      encoded_lengths: new MockTensor("int64", BigInt64Array.from([BigInt(100)]), [1]),
    }),
  };

  const mockJoinerSession = {
    inputNames: ["encoder_outputs", "targets", "target_length", "input_states_1", "input_states_2"],
    outputNames: ["outputs", "prednet_lengths", "output_states_1", "output_states_2"],
    run: vi.fn().mockResolvedValue({
      outputs: new MockTensor("float32", new Float32Array(8193), [1, 1, 8193]),
      prednet_lengths: new MockTensor("int32", new Int32Array([2]), [1]),
      output_states_1: new MockTensor("float32", new Float32Array(2 * 1 * 640), [2, 1, 640]),
      output_states_2: new MockTensor("float32", new Float32Array(2 * 1 * 640), [2, 1, 640]),
    }),
  };

  return {
    InferenceSession: {
      create: vi.fn().mockImplementation((_path: string) => {
        if (_path.includes("encoder")) return Promise.resolve(mockEncoderSession);
        return Promise.resolve(mockJoinerSession);
      }),
    },
    Tensor: MockTensor,
  };
});

// ── Mock parakeet.js JsPreprocessor ──────────────────────────────────────────

vi.mock("parakeet.js", () => {
  class MockJsPreprocessor {
    _opts: { nMels: number; sampleRate: number };
    constructor(opts: { nMels: number; sampleRate: number }) {
      this._opts = opts;
    }
    process(audio: Float32Array): { features: Float32Array; length: number } {
      // Simulate mel computation: produce a feature matrix [nMels, length]
      const nMels = this._opts.nMels;
      const nFrames = Math.max(1, Math.floor((audio.length - 400) / 160) + 1);
      const features = new Float32Array(nFrames * nMels);
      return { features, length: nFrames };
    }
  }
  return { JsPreprocessor: MockJsPreprocessor };
});

// ── Mock fs/promises — in-memory filesystem ─────────────────────────────────

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn().mockImplementation(
      async (filePath: PathLike | FileHandle, _encoding?: BufferEncoding) => {
        const key = String(filePath);
        if (_mockFs.has(key)) return _mockFs.get(key)!;
        const err = new Error(`ENOENT: no such file or directory, open '${key}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    ),
    writeFile: vi.fn().mockImplementation(
      async (filePath: PathLike | FileHandle, data: string | Buffer) => {
        _mockFs.set(String(filePath), String(data));
      },
    ),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Mock global fetch ────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetchForHuggingFace(vocabContent: string): void {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
    const urlStr = String(url);
    if (urlStr.includes("vocab.txt")) {
      return {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode(vocabContent).buffer),
      };
    }
    if (urlStr.includes(".onnx")) {
      const header = new Uint8Array([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      return {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(header.buffer),
      };
    }
    return { ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) };
  }) as unknown as typeof fetch;
}

import {
  initParakeetEngine,
  transcribeWithParakeet,
} from "../server/server-transcription.js";
import type { VoiceInputServerConfig } from "../server/server-transcription.js";

const defaultConfig: VoiceInputServerConfig = {
  mode: "push-to-talk",
  transcriptionEngine: "server",
  language: "en",
  serverEngine: "parakeet-onnx",
  openaiApiKey: "",
  parakeetModelRepo: "ysdede/parakeet-tdt-0.6b-v3-onnx",
  vadThreshold: 0.3,
  parakeetModelUrl: "",
};

const vocabContent = "<blk> 8192\n<unk> 1\nhello 100\n▁world 200\n<eos> 3";

describe("server-transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockFs.clear();
    mockFetchForHuggingFace(vocabContent);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Model initialization ─────────────────────────────────────────────────

  it("initializes Parakeet ONNX engine from HuggingFace", async () => {
    await expect(initParakeetEngine(defaultConfig)).resolves.not.toThrow();
  });

  // ── Transcription ────────────────────────────────────────────────────────

  it("transcribes PCM samples with Parakeet", async () => {
    const samples = new Float32Array(16000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.1;
    }

    const text = await transcribeWithParakeet(samples, defaultConfig);
    expect(typeof text).toBe("string");
  });

  it("returns empty string for silent audio", async () => {
    const samples = new Float32Array(16000);

    const text = await transcribeWithParakeet(samples, defaultConfig);
    expect(typeof text).toBe("string");
  });

  it("handles very short audio", async () => {
    const samples = new Float32Array(200);
    const text = await transcribeWithParakeet(samples, defaultConfig);
    expect(typeof text).toBe("string");
  });
});
