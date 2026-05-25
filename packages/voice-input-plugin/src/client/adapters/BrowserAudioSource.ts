/**
 * BrowserAudioSource — ScriptProcessorNode-based microphone capture
 * implementing IAudioSource for browser streaming transcription.
 *
 * Captures mono 16kHz PCM and emits Float32Array chunks.
 */
import type { IAudioSource } from "../../shared/streaming/types.js";

export class BrowserAudioSource implements IAudioSource {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private active: boolean = false;

  private readonly targetRate: number;

  private readonly chunkCallbacks: Array<(chunk: Float32Array) => void> = [];

  constructor(sampleRate = 16000) {
    this.targetRate = sampleRate;
  }

  onChunk(cb: (chunk: Float32Array) => void): () => void {
    this.chunkCallbacks.push(cb);
    return () => {
      const idx = this.chunkCallbacks.indexOf(cb);
      if (idx >= 0) this.chunkCallbacks.splice(idx, 1);
    };
  }

  async start(): Promise<void> {
    if (this.active) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: this.targetRate },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: this.targetRate });

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      for (const cb of this.chunkCallbacks) {
        cb(copy);
      }
    };

    this.source.connect(this.processor);

    // Route through silent gain to avoid feedback
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);

    this.active = true;
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.audioContext?.close();
    this.stream?.getTracks().forEach((t) => t.stop());

    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
