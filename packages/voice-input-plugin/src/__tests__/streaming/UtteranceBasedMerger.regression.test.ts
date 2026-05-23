/**
 * UtteranceBasedMerger regression fixtures — ported from keet's
 * src/lib/transcription/UtteranceBasedMerger.regression.test.ts.
 *
 * Structured progression fixtures that assert the full merger state
 * (mature, immature, full, cursor) at each step of an expanding
 * streaming window sequence.
 */
import { describe, it, expect } from "vitest";
import { UtteranceBasedMerger } from "../../shared/streaming/UtteranceBasedMerger.js";
import type { ASRResult, ASRWord } from "../../shared/streaming/types.js";

type WordTuple = [text: string, start: number, end?: number];

function wordsFromTuples(tuples: WordTuple[]): ASRWord[] {
  return tuples.map(([text, start, end]) => ({
    text,
    start_time: start,
    end_time: end ?? start + 0.4,
    confidence: 0.9,
  }));
}

function asrFromTuples(tuples: WordTuple[]): ASRResult {
  const words = wordsFromTuples(tuples);
  return {
    utterance_text: words.map((w) => w.text).join(" "),
    words,
    end_time: words.length > 0 ? words[words.length - 1].end_time : 0,
  };
}

function createMerger(): UtteranceBasedMerger {
  return new UtteranceBasedMerger({ useNLP: false, debug: false });
}

describe("UtteranceBasedMerger regression fixtures", () => {
  it("partial-to-full merging remains coherent through expanding windows", async () => {
    const merger = createMerger();

    const fixtures = [
      {
        words: [
          ["hello", 0.0, 0.4],
          ["there", 0.4, 0.8],
        ] as WordTuple[],
        expected: { mature: "", immature: "hello there", full: "hello there", cursor: 0.0 },
      },
      {
        words: [
          ["hello", 0.0, 0.4],
          ["there.", 0.4, 0.8],
          ["how", 0.8, 1.1],
        ] as WordTuple[],
        expected: { mature: "hello there.", immature: "how", full: "hello there. how", cursor: 0.8 },
      },
      {
        words: [
          ["hello", 0.0, 0.4],
          ["there.", 0.4, 0.8],
          ["how", 0.8, 1.1],
          ["are", 1.1, 1.4],
          ["you", 1.4, 1.8],
        ] as WordTuple[],
        expected: {
          mature: "hello there.",
          immature: "how are you",
          full: "hello there. how are you",
          cursor: 0.8,
        },
      },
      {
        words: [
          ["hello", 0.0, 0.4],
          ["there.", 0.4, 0.8],
          ["how", 0.8, 1.1],
          ["are", 1.1, 1.4],
          ["you?", 1.4, 1.8],
          ["next", 1.8, 2.2],
        ] as WordTuple[],
        expected: {
          mature: "hello there. how are you?",
          immature: "next",
          full: "hello there. how are you? next",
          cursor: 1.8,
        },
      },
    ];

    for (const fixture of fixtures) {
      const result = await merger.processASRResult(asrFromTuples(fixture.words));
      expect(result.matureText).toBe(fixture.expected.mature);
      expect(result.immatureText).toBe(fixture.expected.immature);
      expect(result.fullText).toBe(fixture.expected.full);
      expect(result.matureCursorTime).toBe(fixture.expected.cursor);
    }
  });

  it("punctuation and case restoration from overlapping windows uses latest text", async () => {
    const merger = createMerger();

    await merger.processASRResult(
      asrFromTuples([
        ["good", 0.0, 0.3],
        ["morning", 0.3, 0.7],
        ["everyone", 0.7, 1.1],
      ]),
    );

    const refined = await merger.processASRResult(
      asrFromTuples([
        ["Good", 0.0, 0.3],
        ["morning", 0.3, 0.7],
        ["everyone.", 0.7, 1.1],
        ["today", 1.1, 1.4],
      ]),
    );

    expect(refined.matureText).toBe("Good morning everyone.");
    expect(refined.immatureText).toBe("today");
    expect(refined.fullText).toBe("Good morning everyone. today");
  });

  it("repeated words, delayed tokens, and retranscription overlap stay deduped", async () => {
    const merger = createMerger();

    const first = await merger.processASRResult(
      asrFromTuples([
        ["I", 0.0, 0.3],
        ["I", 0.3, 0.6],
        ["think", 0.6, 1.0],
      ]),
    );
    expect(first.immatureText).toBe("I I think");

    const corrected = await merger.processASRResult(
      asrFromTuples([
        ["I", 0.0, 0.3],
        ["think", 0.3, 0.8],
        ["this", 0.8, 1.2],
      ]),
    );
    expect(corrected.immatureText).toBe("I think this");

    const completed = await merger.processASRResult(
      asrFromTuples([
        ["I", 0.0, 0.3],
        ["think", 0.3, 0.8],
        ["this", 0.8, 1.2],
        ["works.", 1.2, 1.6],
        ["now", 1.6, 2.0],
      ]),
    );
    expect(completed.matureText).toBe("I think this works.");
    expect(completed.immatureText).toBe("now");

    const staleOverlap = await merger.processASRResult(
      asrFromTuples([
        ["I", 0.0, 0.3],
        ["think", 0.3, 0.82],
        ["this", 0.82, 1.18],
        ["works.", 1.18, 1.62],
        ["now", 1.62, 2.02],
        ["again", 2.02, 2.4],
      ]),
    );
    expect(staleOverlap.matureText).toBe("I think this works.");
    expect(staleOverlap.immatureText).toBe("now again");
    expect(staleOverlap.allMatureSentences).toHaveLength(1);
  });

  it("short pause does not flush incomplete sentence; long pause flushes complete one", async () => {
    const merger = createMerger();

    await merger.processASRResult(
      asrFromTuples([
        ["we", 0.0, 0.3],
        ["are", 0.3, 0.6],
        ["testing", 0.6, 1.0],
      ]),
    );
    // Incomplete — no terminal punctuation
    expect(merger.finalizePendingSentenceByTimeout()).toBeNull();

    await merger.processASRResult(
      asrFromTuples([
        ["we", 0.0, 0.3],
        ["are", 0.3, 0.6],
        ["testing.", 0.6, 1.0],
      ]),
    );
    // Now complete — flush should work
    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).not.toBeNull();
    expect(flushed!.matureText).toBe("we are testing.");
    expect(flushed!.immatureText).toBe("");
  });

  it("rejects '...' as complete punctuation", async () => {
    const merger = createMerger();

    await merger.processASRResult(
      asrFromTuples([
        ["so", 0.0, 0.3],
        ["I", 0.3, 0.5],
        ["was", 0.5, 0.8],
        ["thinking...", 0.8, 1.2],
      ]),
    );

    // Trailing "..." should not count as sentence-complete
    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).toBeNull();
  });
});
