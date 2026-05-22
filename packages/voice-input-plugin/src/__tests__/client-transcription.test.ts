/**
 * Client-side transcription pipeline tests.
 *
 * Tests the loadModel, getStreamer, transcribeChunks, and lifecycle
 * functions without actually downloading ONNX models.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadModel,
  getStreamer,
  transcribeChunks,
  resetStreamer,
  isModelLoaded,
  isLoadingModel,
  destroyModel,
} from "../client-transcription.js";
import type { VoiceInputConfig } from "../client.js";

// Mock parakeet.js dynamic import
vi.mock("parakeet.js", () => {
  const mockModel = {
    createStreamingTranscriber: vi.fn(() => ({
      processChunk: vi
        .fn()
        .mockResolvedValueOnce({ text: "hello", chunkText: "hello" })
        .mockResolvedValueOnce({ text: "hello world", chunkText: "world" }),
      finalize: vi.fn().mockReturnValue({ text: "hello world", is_final: true }),
      reset: vi.fn(),
    })),
  };

  return {
    fromHub: vi.fn().mockImplementation((_repoId: string, opts?: Record<string, unknown>) => {
      // Call progress callback if provided (to test progress reporting)
      const progressCb = opts?.progress as ((info: { loaded: number; total: number }) => void) | undefined;
      if (progressCb) {
        progressCb({ loaded: 50, total: 100 });
        progressCb({ loaded: 100, total: 100 });
      }
      return Promise.resolve(mockModel);
    }),
    fromUrls: vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
      const progressCb = cfg?.progress as ((info: { loaded: number; total: number }) => void) | undefined;
      if (progressCb) {
        progressCb({ loaded: 100, total: 100 });
      }
      return Promise.resolve(mockModel);
    }),
  };
});

const defaultConfig: VoiceInputConfig = {
  mode: "push-to-talk",
  transcriptionEngine: "client",
  language: "en",
  serverEngine: "parakeet-onnx",
  openaiApiKey: "",
  parakeetModelRepo: "ysdede/parakeet-tdt-0.6b-v3-onnx",
  vadThreshold: 0.3,
  parakeetModelUrl: "",
};

describe("client-transcription", () => {
  beforeEach(() => {
    destroyModel();
    vi.clearAllMocks();
  });

  afterEach(() => {
    destroyModel();
  });

  // ── Model loading ────────────────────────────────────────────────────────

  it("loads model from HuggingFace hub by default", async () => {
    expect(isModelLoaded()).toBe(false);
    const model = await loadModel(defaultConfig);
    expect(model).toBeDefined();
    expect(isModelLoaded()).toBe(true);
  });

  it("loads model from custom URL when parakeetModelUrl is set", async () => {
    const config = { ...defaultConfig, parakeetModelUrl: "https://cdn.example.com/models" };
    const model = await loadModel(config);
    expect(model).toBeDefined();
  });

  it("reuses cached model on subsequent loads", async () => {
    const model1 = await loadModel(defaultConfig);
    const model2 = await loadModel(defaultConfig);
    expect(model1).toBe(model2);
  });

  it("deduplicates concurrent loadModel calls", async () => {
    const [m1, m2] = await Promise.all([
      loadModel(defaultConfig),
      loadModel(defaultConfig),
    ]);
    expect(m1).toBe(m2);
  });

  it("reports progress during model download", async () => {
    const progressValues: number[] = [];
    await loadModel(defaultConfig, (pct) => progressValues.push(pct));
    expect(progressValues.length).toBeGreaterThan(0);
  });

  // ── Streaming transcription ──────────────────────────────────────────────

  it("creates a streaming transcriber from loaded model", () => {
    const model: Record<string, unknown> = { createStreamingTranscriber: vi.fn(() => ({})) };
    const streamer = getStreamer(model as never);
    expect(streamer).toBeDefined();
  });

  it("reuses the same streamer instance", () => {
    const createStub = vi.fn(() => ({}));
    const model: Record<string, unknown> = { createStreamingTranscriber: createStub };
    const s1 = getStreamer(model as never);
    const s2 = getStreamer(model as never);
    expect(s1).toBe(s2);
    expect(createStub).toHaveBeenCalledTimes(1);
  });

  it("transcribes audio chunks via single-shot model.transcribe", async () => {
    // Mock the model's transcribe method to simulate single-shot output
    const mockModel = {
      transcribe: vi.fn().mockResolvedValue({ utterance_text: "hello world" }),
    };

    const chunk = new Float32Array(1600); // 100ms at 16kHz
    const text = await transcribeChunks([chunk, chunk], mockModel as any);
    expect(text).toBe("hello world");
    expect(mockModel.transcribe).toHaveBeenCalledTimes(1);
  });

  it("returns empty string for empty chunks", async () => {
    const mockModel = {
      transcribe: vi.fn(),
    };

    const text = await transcribeChunks([], mockModel as any);
    expect(text).toBe("");
    expect(mockModel.transcribe).not.toHaveBeenCalled();
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  it("resets streamer state", () => {
    const resetStub = vi.fn();
    const model: Record<string, unknown> = { createStreamingTranscriber: vi.fn(() => ({ reset: resetStub })) };
    const streamer = getStreamer(model as never);
    resetStreamer();
    expect((streamer as unknown as Record<string, unknown>).reset).toHaveBeenCalled();
  });

  it("destroy model clears all cached state", async () => {
    await loadModel(defaultConfig);
    expect(isModelLoaded()).toBe(true);

    destroyModel();
    expect(isModelLoaded()).toBe(false);
  });

  it("isLoadingModel returns false when not loading", () => {
    expect(isLoadingModel()).toBe(false);
  });
});
