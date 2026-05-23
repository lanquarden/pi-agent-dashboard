/**
 * WebSocketAudioSource — IAudioSource adapter for server-side streaming.
 *
 * The server receives base64-encoded Float32Array PCM chunks from the browser
 * via WebSocket. This adapter decodes them and pushes to the StreamingTranscriber.
 */
import type { IAudioSource } from "../../shared/streaming/types.js";

export class WebSocketAudioSource implements IAudioSource {
  private callbacks: Array<(chunk: Float32Array) => void> = [];
  private active: boolean = false;

  onChunk(cb: (chunk: Float32Array) => void): () => void {
    this.callbacks.push(cb);
    return () => {
      const idx = this.callbacks.indexOf(cb);
      if (idx >= 0) this.callbacks.splice(idx, 1);
    };
  }

  async start(): Promise<void> {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Push a decoded PCM chunk into the stream.
   * Called by the server handler when a voice_input_stream_chunk message arrives.
   */
  pushChunk(chunk: Float32Array): void {
    if (!this.active) return;
    for (const cb of this.callbacks) {
      cb(chunk);
    }
  }
}
