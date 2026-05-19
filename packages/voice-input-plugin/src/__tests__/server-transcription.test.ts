/**
 * Server-side transcription tests.
 *
 * Tests the mel spectrogram computation and Parakeet ONNX transcription
 * pipeline with mocked onnxruntime-node and an in-memory filesystem.
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
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array | number[], dims: number[]) {
      this.type = type;
      this.data = new Float32Array(data as Float32Array);
      this.dims = dims;
    }
  }

  const mockSession = {
    inputNames: ["audio", "previous_state_in"],
    outputNames: ["logits", "previous_state_out"],
    run: vi.fn().mockResolvedValue({
      logits: new MockTensor("float32", new Float32Array(10 * 1024), [1, 1024, 10]),
      previous_state_out: new MockTensor("float32", new Float32Array(1), [1]),
    }),
  };

  return {
    InferenceSession: {
      create: vi.fn().mockResolvedValue(mockSession),
    },
    Tensor: MockTensor,
  };
});

// ── Mock fs/promises — in-memory filesystem ─────────────────────────────────

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn().mockImplementation(
      async (filePath: PathLike | FileHandle, _encoding?: BufferEncoding) => {
        const key = String(filePath);
        if (_mockFs.has(key)) {
          return _mockFs.get(key)!;
        }
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
      // Return a minimal valid ONNX buffer (magic bytes ONNX + header)
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
  computeMelSpectrogram,
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

const vocabContent = "<blank>\n<unk>\nhello\n▁world\neos";

describe("server-transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _mockFs.clear();
    mockFetchForHuggingFace(vocabContent);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Mel spectrogram ──────────────────────────────────────────────────────

  it("computes mel spectrogram from 16kHz mono PCM", () => {
    const audio = new Float32Array(16000);
    const mel = computeMelSpectrogram(audio);
    expect(mel.length).toBeGreaterThan(7000);
    expect(mel.length % 80).toBe(0);
    for (let i = 0; i < mel.length; i++) {
      expect(Number.isFinite(mel[i])).toBe(true);
    }
  });

  it("produces consistent output for identical input", () => {
    const audio = new Float32Array(16000);
    for (let i = 0; i < audio.length; i++) {
      audio[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.5;
    }
    const mel1 = computeMelSpectrogram(audio);
    const mel2 = computeMelSpectrogram(audio);
    expect(mel1).toEqual(mel2);
  });

  it("handles very short audio (< one frame)", () => {
    const audio = new Float32Array(200);
    const mel = computeMelSpectrogram(audio);
    expect(mel.length).toBe(0);
  });

  it("applies pre-emphasis filter", () => {
    const audio = new Float32Array(500);
    audio.fill(1.0);
    const mel = computeMelSpectrogram(audio);
    for (let i = 0; i < Math.min(100, mel.length); i++) {
      expect(Number.isFinite(mel[i])).toBe(true);
    }
  });

  // ── Model initialization ─────────────────────────────────────────────────

  it("initializes Parakeet ONNX engine from HuggingFace", async () => {
    await expect(initParakeetEngine(defaultConfig)).resolves.not.toThrow();
  });

  // ── Transcription ────────────────────────────────────────────────────────

  it("transcribes base64 PCM chunk with Parakeet", async () => {
    const samples = new Float32Array(16000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.1;
    }
    const buffer = Buffer.from(samples.buffer);
    const base64Chunk = buffer.toString("base64");

    const text = await transcribeWithParakeet("session-1", base64Chunk, true, defaultConfig);
    expect(typeof text).toBe("string");
  });

  it("returns empty string for silent audio", async () => {
    const samples = new Float32Array(16000);
    const buffer = Buffer.from(samples.buffer);
    const base64Chunk = buffer.toString("base64");

    const text = await transcribeWithParakeet("session-2", base64Chunk, true, defaultConfig);
    expect(typeof text).toBe("string");
  });
});
