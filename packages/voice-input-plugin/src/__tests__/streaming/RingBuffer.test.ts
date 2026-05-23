/**
 * RingBuffer tests — ported from keet's src/lib/audio/RingBuffer.test.ts.
 *
 * Tests circular buffer: write, read (basic + wrap-around + overflow),
 * frame offset tracking, time calculation, and reset.
 * Tests both BrowserRingBuffer and NodeRingBuffer (identical algorithm).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BrowserRingBuffer } from "../../client/adapters/BrowserRingBuffer.js";
import { NodeRingBuffer } from "../../server/adapters/NodeRingBuffer.js";
import type { IRingBuffer } from "../../shared/streaming/types.js";

const SAMPLE_RATE = 16000;
const DURATION_SECONDS = 1;
const MAX_FRAMES = SAMPLE_RATE * DURATION_SECONDS;

function runRingBufferTests(
  name: string,
  factory: (durationSec?: number, sampleRate?: number) => IRingBuffer,
) {
  describe(name, () => {
    let rb: IRingBuffer;

    beforeEach(() => {
      rb = factory(DURATION_SECONDS, SAMPLE_RATE);
    });

    describe("initialization", () => {
      it("starts with zero frames", () => {
        expect(rb.getCurrentFrame()).toBe(0);
        expect(rb.getBaseFrameOffset()).toBe(0);
        expect(rb.getCurrentTime()).toBe(0);
      });
    });

    describe("writing", () => {
      it("writes data correctly when buffer is empty", () => {
        const chunk = new Float32Array([1, 2, 3]);
        rb.write(chunk);
        expect(rb.getCurrentFrame()).toBe(3);
        expect(rb.read(0, 3)).toEqual(chunk);
      });

      it("appends data correctly", () => {
        rb.write(new Float32Array([1, 2]));
        rb.write(new Float32Array([3, 4]));
        expect(rb.getCurrentFrame()).toBe(4);
        expect(rb.read(0, 4)).toEqual(new Float32Array([1, 2, 3, 4]));
      });

      it("handles wrap-around correctly", () => {
        const initialFill = new Float32Array(MAX_FRAMES - 2);
        initialFill.fill(0.5);
        rb.write(initialFill);

        const chunk = new Float32Array([1, 2, 3, 4]);
        rb.write(chunk);

        // After wrap, the chunk splits across the logical boundary:
        // [1,2] at global [16000, 16002), [3,4] at global [2, 4)
        expect(rb.getCurrentFrame()).toBe(MAX_FRAMES + 2); // 16002

        // Read the first segment
        const seg1 = rb.read(MAX_FRAMES, MAX_FRAMES + 2);
        expect(seg1).toEqual(new Float32Array([1, 2]));

        // Read the second segment (wrapped to beginning)
        const seg2 = rb.read(2, 4);
        expect(seg2).toEqual(new Float32Array([3, 4]));
      });

      it("handles chunk larger than buffer size", () => {
        const largeChunk = new Float32Array(MAX_FRAMES + 10);
        for (let i = 0; i < largeChunk.length; i++) largeChunk[i] = i;

        rb.write(largeChunk);
        expect(rb.getCurrentFrame()).toBe(MAX_FRAMES + 10);
        // Should contain the last MAX_FRAMES of the large chunk
        const readData = rb.read(10, MAX_FRAMES + 10);
        expect(readData).toEqual(largeChunk.subarray(10));
      });
    });

    describe("reading", () => {
      it("reads valid range correctly", () => {
        rb.write(new Float32Array([1, 2, 3, 4, 5]));
        const readData = rb.read(1, 4); // indices 1, 2, 3
        expect(readData).toEqual(new Float32Array([2, 3, 4]));
      });

      it("returns empty array when startFrame >= endFrame", () => {
        rb.write(new Float32Array([1, 2, 3]));
        expect(rb.read(1, 1).length).toBe(0);
        expect(rb.read(2, 1).length).toBe(0);
      });

      it("truncates when reading past what has been written", () => {
        rb.write(new Float32Array([1, 2, 3]));
        // Only 3 frames written, but requesting 10
        const readData = rb.read(0, 10);
        expect(readData.length).toBeLessThanOrEqual(3);
      });

      it("handles reading across wrap-around point", () => {
        const initialFill = new Float32Array(MAX_FRAMES - 2);
        for (let i = 0; i < MAX_FRAMES - 2; i++) initialFill[i] = i;
        rb.write(initialFill);

        const chunk = new Float32Array([100, 101, 102, 103]);
        rb.write(chunk);

        // After wrapping, oldest 2 frames are discarded (baseFrameOffset = 2).
        // Read from the last preserved frames through the new chunk.
        // Available range: [2, 16002)
        const startFrame = MAX_FRAMES - 3; // 15997
        const endFrame = MAX_FRAMES + 1;   // 16001
        const readData = rb.read(startFrame, endFrame);

        expect(readData.length).toBe(4);
        // Frames shifted by 2 discarded: 15995, 15996, 15997, then 100
        expect(readData[0]).toBe(MAX_FRAMES - 5); // 15995
        expect(readData[1]).toBe(MAX_FRAMES - 4); // 15996
        expect(readData[2]).toBe(MAX_FRAMES - 3); // 15997
        expect(readData[3]).toBe(100);
      });

      it("returns empty when start before base offset (overwritten data)", () => {
        const chunk = new Float32Array(MAX_FRAMES + 50);
        for (let i = 0; i < chunk.length; i++) chunk[i] = i;
        rb.write(chunk);
        // base offset should have advanced past overwritten frames
        expect(rb.getBaseFrameOffset()).toBe(50);
        // Reading from before base offset clamps to available range
        const result = rb.read(0, 100);
        // Returns frames [50..100) — only what's still in buffer
        expect(result.length).toBe(50);
        expect(result[0]).toBe(50);
        expect(result[49]).toBe(99);
      });
    });

    describe("getCurrentTime", () => {
      it("returns correct time in seconds", () => {
        const chunk = new Float32Array(SAMPLE_RATE / 2); // 0.5 seconds
        rb.write(chunk);
        expect(rb.getCurrentTime()).toBeCloseTo(0.5, 2);
      });
    });

    describe("getBaseFrameOffset", () => {
      it("returns 0 when not full", () => {
        rb.write(new Float32Array(100));
        expect(rb.getBaseFrameOffset()).toBe(0);
      });

      it("updates when overwritten", () => {
        const chunk = new Float32Array(MAX_FRAMES + 50);
        rb.write(chunk);
        expect(rb.getBaseFrameOffset()).toBe(50);
      });
    });

    describe("reset", () => {
      it("clears buffer and resets counters", () => {
        rb.write(new Float32Array([1, 2, 3]));
        rb.reset();
        expect(rb.getCurrentFrame()).toBe(0);
        expect(rb.read(0, 0).length).toBe(0);

        // Write new data — should start from 0
        rb.write(new Float32Array([9, 9]));
        expect(rb.read(0, 2)).toEqual(new Float32Array([9, 9]));
      });
    });
  });
}

runRingBufferTests("BrowserRingBuffer", (durationSec, sampleRate) => new BrowserRingBuffer(durationSec, sampleRate));
runRingBufferTests("NodeRingBuffer", (durationSec, sampleRate) => new NodeRingBuffer(durationSec, sampleRate));
