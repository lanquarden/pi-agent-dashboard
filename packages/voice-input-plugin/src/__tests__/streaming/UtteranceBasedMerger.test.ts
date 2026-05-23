/**
 * UtteranceBasedMerger tests — ported from keet's
 * src/lib/transcription/UtteranceBasedMerger.test.ts.
 *
 * Tests sentence-level merge: mature/pending split, cursor advancement,
 * dedup by normalized text + timestamp, flush semantics, and reset.
 *
 * NLP is disabled for deterministic testing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { UtteranceBasedMerger } from "../../shared/streaming/UtteranceBasedMerger.js";
import type { ASRResult, ASRWord } from "../../shared/streaming/types.js";

function mkWord(text: string, start: number, end?: number): ASRWord {
  return { text, start_time: start, end_time: end ?? start + 0.5, confidence: 0.9 };
}

function asr(words: ASRWord[]): ASRResult {
  return {
    utterance_text: words.map((w) => w.text).join(" "),
    words,
    end_time: words.length > 0 ? words[words.length - 1].end_time : 0,
  };
}

function createMerger(): UtteranceBasedMerger {
  return new UtteranceBasedMerger({ useNLP: false, debug: false });
}

describe("UtteranceBasedMerger", () => {
  let merger: UtteranceBasedMerger;

  beforeEach(() => {
    merger = createMerger();
  });

  // ── Sentence finalization ───────────────────────────────────────────────

  it("keeps single sentence as immature", async () => {
    const result = await merger.processASRResult(
      asr([mkWord("Hello", 0), mkWord("world.", 0.5)]),
    );
    expect(result.matureText).toBe("");
    expect(result.immatureText).toBe("Hello world.");
    expect(result.matureCursorTime).toBe(0);
    expect(result.allMatureSentences).toHaveLength(0);
  });

  it("finalizes all but last sentence when multiple sentences present", async () => {
    const result = await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0),
        mkWord("world.", 0.5),
        mkWord("How", 1.0),
        mkWord("are", 1.5),
        mkWord("you?", 2.0),
      ]),
    );

    expect(result.matureText).toBe("Hello world.");
    expect(result.immatureText).toBe("How are you?");
    expect(result.matureCursorTime).toBe(1.0);
    expect(result.allMatureSentences).toHaveLength(1);
  });

  // ── Cursor advancement ──────────────────────────────────────────────────

  it("advances mature cursor across sequential windows", async () => {
    await merger.processASRResult(
      asr([mkWord("Sentence", 0.0), mkWord("one.", 0.5), mkWord("Start", 1.0)]),
    );

    const cycle2 = await merger.processASRResult(
      asr([mkWord("Start", 1.0), mkWord("two.", 1.5), mkWord("End", 2.0)]),
    );

    expect(cycle2.matureText).toBe("Sentence one. Start two.");
    expect(cycle2.immatureText).toBe("End");
    expect(cycle2.matureCursorTime).toBe(2.0);
  });

  // ── Dedup ───────────────────────────────────────────────────────────────

  it("does not re-add a finalized sentence seen in a previous window", async () => {
    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world.", 0.5), mkWord("How", 1.0)]),
    );

    const stale = await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0),
        mkWord("world.", 0.5),
        mkWord("How", 1.0),
        mkWord("are", 1.5),
      ]),
    );

    expect(stale.allMatureSentences).toHaveLength(1);
    expect(stale.matureText).toBe("Hello world.");
    expect(stale.immatureText).toBe("How are");
  });

  it("tolerates small timing jitter for dedup", async () => {
    await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0, 0.5),
        mkWord("world.", 0.5, 1.0),
        mkWord("More", 1.0, 1.5),
      ]),
    );

    const jittered = await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0, 0.48),
        mkWord("world.", 0.48, 1.05),
        mkWord("More", 1.05, 1.55),
        mkWord("text.", 1.55, 2.05),
      ]),
    );

    expect(jittered.allMatureSentences).toHaveLength(1);
    expect(jittered.matureText).toBe("Hello world.");
    expect(jittered.immatureText).toBe("More text.");
  });

  it("reprocessing identical window does not duplicate mature sentences", async () => {
    const base = [
      mkWord("cooperating.", 4.5, 5.0),
      mkWord("Third", 5.0, 5.5),
      mkWord("round.", 5.5, 6.0),
    ];

    await merger.processASRResult(asr(base));
    await merger.processASRResult(asr(base));
    const third = await merger.processASRResult(asr(base));

    expect(third.allMatureSentences).toHaveLength(1);
    expect(third.fullText).toBe("cooperating. Third round.");
  });

  // ── Flush / finalize ────────────────────────────────────────────────────

  it("finalizes pending sentence on timeout flush when punctuation-complete", async () => {
    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world.", 0.5)]),
    );

    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).not.toBeNull();
    expect(flushed!.matureText).toBe("Hello world.");

    // Stale reprocess should stay deduped
    const stale = await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0),
        mkWord("world.", 0.5),
        mkWord("How", 1.0),
        mkWord("are", 1.5),
      ]),
    );

    expect(stale.allMatureSentences).toHaveLength(1);
    expect(stale.immatureText).toBe("How are");
  });

  it("returns null from flush when nothing is pending", async () => {
    await merger.processASRResult(
      asr([mkWord("Done.", 0.0, 0.5)]),
    );

    const firstFlush = merger.finalizePendingSentenceByTimeout();
    const secondFlush = merger.finalizePendingSentenceByTimeout();

    expect(firstFlush).not.toBeNull();
    expect(secondFlush).toBeNull();
  });

  it("does not flush pending sentence without terminal punctuation", async () => {
    await merger.processASRResult(
      asr([mkWord("This", 0.0), mkWord("is", 0.3), mkWord("incomplete", 0.6)]),
    );

    const flushed = merger.finalizePendingSentenceByTimeout();
    expect(flushed).toBeNull();

    // Text should still be pending
    expect(merger.getImmatureText()).toBe("This is incomplete");
  });

  it("forceFinalizeAll promotes pending regardless of punctuation", async () => {
    await merger.processASRResult(
      asr([mkWord("Unfinished", 0.0), mkWord("thought", 0.5)]),
    );

    merger.forceFinalizeAll();

    expect(merger.getMatureText()).toBe("Unfinished thought");
    expect(merger.getImmatureText()).toBe("");
  });

  it("forceFinalizeAll is dedup-safe", async () => {
    await merger.processASRResult(
      asr([mkWord("Test", 0.0), mkWord("sentence.", 0.5)]),
    );
    merger.forceFinalizeAll();

    const next = await merger.processASRResult(
      asr([
        mkWord("Test", 0.0),
        mkWord("sentence.", 0.5),
        mkWord("New", 1.0),
        mkWord("words.", 1.5),
      ]),
    );

    expect(next.allMatureSentences).toHaveLength(1);
    expect(next.immatureText).toBe("New words.");
  });

  // ── Expanding windows replace immature ──────────────────────────────────

  it("expanding windows replace immature buffer instead of accumulating", async () => {
    await merger.processASRResult(asr([mkWord("Hello", 0.0)]));
    expect(merger.getImmatureText()).toBe("Hello");

    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world", 0.5)]),
    );
    expect(merger.getImmatureText()).toBe("Hello world");

    const third = await merger.processASRResult(
      asr([
        mkWord("Hello", 0.0),
        mkWord("world.", 0.5),
        mkWord("How", 1.0),
      ]),
    );
    expect(third.matureText).toBe("Hello world.");
    expect(third.immatureText).toBe("How");
    expect(third.matureCursorTime).toBe(1.0);
  });

  // ── Dedup with longer history ───────────────────────────────────────────

  it("keeps recent duplicates deduped through longer mature histories", async () => {
    await merger.processASRResult(
      asr([mkWord("One", 0.0), mkWord("done.", 0.5), mkWord("Two", 1.0)]),
    );
    await merger.processASRResult(
      asr([mkWord("Two", 1.0), mkWord("done.", 1.5), mkWord("Three", 2.0)]),
    );
    await merger.processASRResult(
      asr([mkWord("Three", 2.0), mkWord("done.", 2.5), mkWord("Four", 3.0)]),
    );

    const stale = await merger.processASRResult(
      asr([
        mkWord("Three", 2.0),
        mkWord("done.", 2.5),
        mkWord("Four", 3.0),
        mkWord("pending", 3.5),
      ]),
    );

    expect(stale.matureText).toBe("One done. Two done. Three done.");
    expect(stale.allMatureSentences).toHaveLength(3);
    expect(stale.immatureText).toBe("Four pending");
  });

  // ── Reset ───────────────────────────────────────────────────────────────

  it("reset clears all state", async () => {
    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world.", 0.5), mkWord("More", 1.0)]),
    );

    merger.reset();

    expect(merger.getMatureText()).toBe("");
    expect(merger.getImmatureText()).toBe("");
    expect(merger.getMatureCursorTime()).toBe(0);
    expect(merger.getPendingSentence()).toBeNull();
  });

  // ── Cache ───────────────────────────────────────────────────────────────

  it("mature text cache refreshes when new sentences finalize", async () => {
    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world.", 0.5), mkWord("How", 1.0)]),
    );
    expect(merger.getMatureText()).toBe("Hello world.");
    expect(merger.getMatureText()).toBe("Hello world."); // cached

    await merger.processASRResult(
      asr([
        mkWord("How", 1.0),
        mkWord("are", 1.5),
        mkWord("you?", 2.0),
        mkWord("Next", 2.5),
      ]),
    );

    expect(merger.getMatureText()).toBe("Hello world. How are you?");
    expect(merger.getFullText()).toBe("Hello world. How are you? Next");
  });

  // ── Empty input ─────────────────────────────────────────────────────────

  it("empty input preserves current state", async () => {
    await merger.processASRResult(
      asr([mkWord("Hello", 0.0), mkWord("world.", 0.5), mkWord("How", 1.0)]),
    );

    const before = merger.getFullText();
    const after = await merger.processASRResult({
      utterance_text: "",
      words: [],
      end_time: 0,
    });

    expect(after.fullText).toBe(before);
    expect(after.matureCursorTime).toBe(1.0);
  });
});
