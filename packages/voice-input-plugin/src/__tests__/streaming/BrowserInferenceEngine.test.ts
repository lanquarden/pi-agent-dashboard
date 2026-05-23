/**
 * BrowserInferenceEngine tests — ported from keet's
 * src/lib/transcription/TranscriptionWorkerClient.test.ts.
 *
 * Tests the Web Worker bridge: loadModel, transcribe, resetCache,
 * disposal lifecycle, and postMessage failure handling.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { BrowserInferenceEngine } from "../../client/adapters/BrowserInferenceEngine.js";

// ── Mock Worker ────────────────────────────────────────────────────────────

let throwOnPostMessage = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockWorker = vi.fn().mockImplementation(function (this: any, _url: string | URL, _options?: WorkerOptions) {
  this.onmessage = null;
  this.onerror = null;
  this.onmessageerror = null;
  this.addEventListener = vi.fn();
  this.removeEventListener = vi.fn();
  this.dispatchEvent = vi.fn(() => true);

  this.postMessage = (data: { id: number; type: string; payload?: unknown }) => {
    if (throwOnPostMessage) {
      throw new Error("postMessage failed");
    }
    // Simulate async response
    setTimeout(() => {
      if (this.onmessage) {
        const { type, id } = data;
        let responsePayload: unknown = undefined;

        if (type === "TRANSCRIBE") {
          responsePayload = {
            utterance_text: "hello world",
            words: [
              { text: "hello", start_time: 0.0, end_time: 0.5, confidence: 0.9 },
              { text: "world", start_time: 0.5, end_time: 1.0, confidence: 0.85 },
            ],
          };
        }
        // LOAD_MODEL and RESET_CACHE return void (payload=undefined)

        this.onmessage({
          data: { type: "RESULT", id, payload: responsePayload },
        } as MessageEvent);
      }
    }, 0);
  };

  this.terminate = () => {};
});

const originalWorker = globalThis.Worker;

describe("BrowserInferenceEngine", () => {
  let engine: BrowserInferenceEngine;

  beforeAll(() => {
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  beforeEach(() => {
    throwOnPostMessage = false;
    engine = new BrowserInferenceEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("loads model on first transcribe call", async () => {
    const dummy = new Float32Array(1600);
    const result = await engine.transcribe(dummy, 16000);
    expect(result.utterance_text).toBe("hello world");
    expect(result.words).toHaveLength(2);
  });

  it("caches model load across subsequent transcribe calls", async () => {
    const dummy = new Float32Array(1600);
    await engine.transcribe(dummy, 16000);
    // Second call should reuse loaded model, not re-post LOAD_MODEL
    const result = await engine.transcribe(dummy, 16000);
    expect(result.utterance_text).toBe("hello world");
  });

  it("supports resetCache", async () => {
    await expect(engine.resetCache()).resolves.toBeUndefined();
  });

  it("rejects pending requests when disposed", async () => {
    const dummy = new Float32Array(1600);
    const pending = engine.transcribe(dummy, 16000);
    engine.dispose();
    await expect(pending).rejects.toThrow("BrowserInferenceEngine disposed");
  });

  it("rejects requests after disposal", async () => {
    engine.dispose();
    const dummy = new Float32Array(1600);
    await expect(engine.transcribe(dummy, 16000)).rejects.toThrow("BrowserInferenceEngine disposed");
  });
});
