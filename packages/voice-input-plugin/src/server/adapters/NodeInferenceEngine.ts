/**
 * NodeInferenceEngine — direct onnxruntime-node inference implementing ITranscriptionEngine.
 *
 * Wraps the existing server-side Parakeet ONNX model (from server-transcription.ts)
 * behind the abstract ITranscriptionEngine interface. Supports incremental decoder
 * cache for overlapping streaming windows.
 *
 * The parakeet.js model.transcribe() API is identical in browser and Node —
 * this adapter just delegates to it.
 */
import type {
  ITranscriptionEngine,
  TranscribeOpts,
  TranscribeResult,
} from "../../shared/streaming/types.js";

export class NodeInferenceEngine implements ITranscriptionEngine {
  private model: Record<string, unknown> | null = null;
  private loadPromise: Promise<Record<string, unknown>> | null = null;

  constructor(
    private getModel: () => Promise<Record<string, unknown>>,
  ) {}

  private async ensureModel(): Promise<Record<string, unknown>> {
    if (this.model) return this.model;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      this.model = await this.getModel();
      return this.model;
    })();

    return this.loadPromise;
  }

  async transcribe(
    audio: Float32Array,
    sampleRate: number,
    opts?: TranscribeOpts,
  ): Promise<TranscribeResult> {
    const model = await this.ensureModel();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (model as any).transcribe(audio, sampleRate, {
      returnTimestamps: opts?.returnTimestamps,
      returnTokenIds: opts?.returnTokenIds,
      timeOffset: opts?.timeOffset,
      frameStride: opts?.frameStride,
      ...(opts?.incremental
        ? { incremental: opts.incremental }
        : {}),
      ...(opts?.prefixSamples
        ? { prefixSamples: opts.prefixSamples }
        : {}),
    });

    return {
      utterance_text: result.utterance_text || "",
      words: result.words?.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (w: any) => ({
          text: w.text,
          start_time: w.start_time,
          end_time: w.end_time,
          confidence: w.confidence,
        }),
      ),
      metrics: result.metrics,
    };
  }

  async resetCache(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.model as any)?.resetMelCache?.();
  }
}
