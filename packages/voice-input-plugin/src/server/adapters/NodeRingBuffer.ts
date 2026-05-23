/**
 * NodeRingBuffer — Float32Array-backed circular buffer implementing IRingBuffer for Node.js.
 *
 * Same algorithm as BrowserRingBuffer.
 */
import type { IRingBuffer } from "../../shared/streaming/types.js";

export class NodeRingBuffer implements IRingBuffer {
  private buffer: Float32Array;
  private writePos: number = 0;
  private baseFrameOffset: number = 0;
  private frameCount: number = 0;
  private readonly maxFrames: number;
  private readonly sampleRate: number;

  constructor(durationSec = 120, sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this.maxFrames = Math.ceil(durationSec * sampleRate);
    this.buffer = new Float32Array(this.maxFrames);
  }

  write(chunk: Float32Array): void {
    const n = chunk.length;
    if (n === 0) return;
    this.frameCount += n;

    if (n > this.maxFrames) {
      const offset = n - this.maxFrames;
      this.buffer.set(chunk.subarray(offset));
      this.writePos = 0;
      this.baseFrameOffset = this.frameCount - this.maxFrames;
      return;
    }

    const spaceAtEnd = this.maxFrames - this.writePos;
    if (n <= spaceAtEnd) {
      this.buffer.set(chunk, this.writePos);
      this.writePos += n;
      if (this.writePos >= this.maxFrames) this.writePos = 0;
    } else {
      this.buffer.set(chunk.subarray(0, spaceAtEnd), this.writePos);
      const remaining = n - spaceAtEnd;
      this.buffer.set(chunk.subarray(spaceAtEnd), 0);
      this.writePos = remaining;
    }

    if (this.frameCount > this.maxFrames) {
      this.baseFrameOffset = this.frameCount - this.maxFrames;
    }
  }

  read(startFrame: number, endFrame: number): Float32Array {
    if (startFrame >= endFrame) return new Float32Array(0);

    const availableEnd = this.getCurrentFrame();
    const clampedStart = Math.max(startFrame, this.baseFrameOffset);
    const clampedEnd = Math.min(endFrame, availableEnd);
    if (clampedStart >= clampedEnd) return new Float32Array(0);

    const len = clampedEnd - clampedStart;
    const out = new Float32Array(len);
    const bufLen = this.maxFrames;

    for (let i = 0; i < len; i++) {
      const globalFrame = clampedStart + i;
      const pos = ((globalFrame - this.baseFrameOffset) % bufLen + bufLen) % bufLen;
      out[i] = this.buffer[pos];
    }

    return out;
  }

  getCurrentFrame(): number {
    return this.baseFrameOffset + Math.min(this.frameCount, this.maxFrames);
  }

  getBaseFrameOffset(): number {
    return this.baseFrameOffset;
  }

  getCurrentTime(): number {
    return this.getCurrentFrame() / this.sampleRate;
  }

  reset(): void {
    this.buffer.fill(0);
    this.writePos = 0;
    this.baseFrameOffset = 0;
    this.frameCount = 0;
  }
}
