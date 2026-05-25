/**
 * BrowserInferenceEngine — implements ITranscriptionEngine.
 *
 * Two modes:
 * - Main-thread: when constructed with a pre-loaded parakeet model, runs
 *   inference directly on the main thread (no worker). This is the default
 *   for client-side streaming — the Blob URL worker cannot resolve bare
 *   module specifiers like `import("parakeet.js")` in the browser.
 * - Worker (legacy): when constructed without a model, spawns a Web Worker
 *   with inline Blob. Kept for future use once worker module resolution
 *   is solved (e.g. Vite's native Worker bundling).
 *
 * Audio buffers are transferred with zero-copy Transferable for performance.
 * The worker loads the model once and handles multiple transcribe() calls,
 * supporting incremental decoder cache for overlapping streaming windows.
 */
import type {
  ITranscriptionEngine,
  TranscribeOpts,
  TranscribeResult,
} from "../../shared/streaming/types.js";

// ── Worker message types ────────────────────────────────────────────────────

interface WorkerRequest {
  id: number;
  type: "LOAD_MODEL" | "TRANSCRIBE" | "RESET_CACHE";
  payload?: unknown;
}

interface WorkerResponse {
  id: number;
  type: "RESULT" | "ERROR";
  payload?: unknown;
}

// ── Worker script (inline Blob) ─────────────────────────────────────────────

function createWorkerScript(): string {
  return `
    let _model = null;
    let _streamKey = null;

    async function loadModel() {
      if (_model) return;
      const pk = await import("parakeet.js");
      _model = await pk.fromHub("ysdede/parakeet-tdt-0.6b-v3-onnx", {
        backend: "webgpu-hybrid",
        encoderQuant: "fp32",
        decoderQuant: "int8",
        preprocessorBackend: "js",
      });
      self.postMessage({ type: "MODEL_READY" });
    }

    self.onmessage = async (e) => {
      const { id, type, payload } = e.data;

      try {
        switch (type) {
          case "LOAD_MODEL": {
            await loadModel();
            self.postMessage({ id, type: "RESULT" });
            break;
          }
          case "TRANSCRIBE": {
            if (!_model) await loadModel();
            const { audio, sampleRate, opts } = payload;
            const audioArr = new Float32Array(audio);
            const result = await _model.transcribe(audioArr, sampleRate, opts);
            // Transfer words array (send as plain objects, not typed arrays)
            const plain = {
              utterance_text: result.utterance_text || "",
              words: result.words?.map(w => ({
                text: w.text,
                start_time: w.start_time,
                end_time: w.end_time,
                confidence: w.confidence,
              })),
              metrics: result.metrics ? { ...result.metrics } : undefined,
            };
            self.postMessage({ id, type: "RESULT", payload: plain });
            break;
          }
          case "RESET_CACHE": {
            _model?.resetMelCache?.();
            self.postMessage({ id, type: "RESULT" });
            break;
          }
        }
      } catch (err) {
        self.postMessage({ id, type: "ERROR", payload: err?.message || String(err) });
      }
    };
  `;
}

// ── Inference engine ────────────────────────────────────────────────────────

export class BrowserInferenceEngine implements ITranscriptionEngine {
  /** Pre-loaded parakeet model for main-thread inference (null = use worker). */
  private model: any | null = null;
  private worker: Worker | null = null;
  private messageId: number = 0;
  private pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  > = new Map();
  private loaded: boolean = false;
  private loadPromise: Promise<void> | null = null;
  private disposed: boolean = false;

  /**
   * @param model - Pre-loaded parakeet model for main-thread inference.
   *   When provided, no Web Worker is created. When omitted, falls back
   *   to the Blob URL worker path (which will fail in browser because
   *   bare `import("parakeet.js")` cannot be resolved).
   */
  constructor(model?: any) {
    if (model) {
      this.model = model;
      this.loaded = true;
      console.debug("[BrowserInferenceEngine] using main-thread inference");
      return;
    }

    console.debug("[BrowserInferenceEngine] creating Web Worker (Blob URL)");
    const blob = new Blob([createWorkerScript()], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url, { type: "module" });
    URL.revokeObjectURL(url);

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, type, payload } = e.data;
      const handlers = this.pending.get(id);
      if (!handlers) return;
      this.pending.delete(id);

      if (type === "ERROR") {
        handlers.reject(new Error(payload as string));
      } else {
        handlers.resolve(payload);
      }
    };

    this.worker.onerror = (e) => {
      console.error("[BrowserInferenceEngine] Worker error:", e);
    };
  }

  private async sendRequest(type: string, payload?: unknown): Promise<unknown> {
    if (this.disposed) {
      throw new Error("BrowserInferenceEngine disposed");
    }
    const id = this.messageId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type, payload });
    });
  }

  /**
   * Ensure the model is loaded. No-op if pre-loaded model was provided.
   */
  async loadModel(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;

    console.debug("[BrowserInferenceEngine] loading model via worker...");
    this.loadPromise = (async () => {
      await this.sendRequest("LOAD_MODEL");
      this.loaded = true;
      console.debug("[BrowserInferenceEngine] worker model loaded");
    })();

    return this.loadPromise;
  }

  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    opts?: TranscribeOpts,
  ): Promise<TranscribeResult> {
    if (this.model) {
      const startMs = performance.now();
      console.debug("[BrowserInferenceEngine] transcribe (main-thread):", { samples: audio.length, sampleRate, opts });
      // Pass opts through to the model. Match keet's v4 call signature:
      // no `language` (not a valid parakeet option — may corrupt output),
      // frameStride defaults to 1 for normal decoder speed.
      const result = await this.model.transcribe(audio, sampleRate, {
        returnTimestamps: opts?.returnTimestamps ?? false,
        timeOffset: opts?.timeOffset,
        frameStride: opts?.frameStride ?? 1,
        ...(opts?.incremental ? { incremental: opts.incremental } : {}),
      });
      const elapsed = (performance.now() - startMs).toFixed(0);
      const uttText = result?.utterance_text || result?.text || "";
      console.debug("[BrowserInferenceEngine] transcribe result:", { text: uttText.slice(0, 80), textLen: uttText.length, words: result?.words?.length ?? 0, elapsedMs: elapsed });
      return {
        utterance_text: uttText,
        words: result?.words?.map((w: any) => ({
          text: w.text,
          start_time: w.start_time,
          end_time: w.end_time,
          confidence: w.confidence,
        })),
        metrics: result?.metrics ? { ...result.metrics } : undefined,
      };
    }

    await this.loadModel();

    // Transfer audio buffer for zero-copy
    const result = await this.sendRequest("TRANSCRIBE", {
      audio: audio.buffer,
      sampleRate,
      opts,
    });

    return result as TranscribeResult;
  }

  async resetCache(): Promise<void> {
    if (this.model) {
      this.model.resetMelCache?.();
      return;
    }
    await this.sendRequest("RESET_CACHE");
  }

  /**
   * Dispose the worker and reject all pending requests.
   */
  dispose(): void {
    this.disposed = true;
    if (this.model) {
      this.model = null;
      return;
    }
    this.worker?.terminate();
    this.worker = null;
    for (const [, handlers] of this.pending) {
      handlers.reject(new Error("BrowserInferenceEngine disposed"));
    }
    this.pending.clear();
  }
}
