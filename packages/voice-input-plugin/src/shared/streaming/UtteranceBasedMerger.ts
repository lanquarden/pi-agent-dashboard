/**
 * Shared UtteranceBasedMerger — sentence-level merge of per-window ASR results.
 *
 * Ported from keet's src/lib/transcription/UtteranceBasedMerger.ts.
 * Zero platform dependencies — works in browser and Node.
 *
 * Algorithm:
 *   1. Accept per-window ASR results (words with timestamps)
 *   2. Split utterance text into sentences (wink-nlp, regex heuristic fallback)
 *   3. All sentences except the last → finalized candidates
 *   4. Dedup finalized candidates against history (normalized text + end-time tolerance)
 *   5. Non-duplicate finalized sentences → mature (confirmed) transcript
 *   6. Last sentence → pending (tentative), displayed dimly in UI
 *   7. On flush/timeout → finalize pending if punctuation-complete
 *
 * wink-nlp is a soft dependency — the merger falls back to regex sentence
 * splitting if the library is unavailable.
 */
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
import type { ASRResult, ASRWord, MergerResult, MergerSentence } from "./types.js";

// ── Config ──────────────────────────────────────────────────────────────────

export interface UtteranceBasedMergerConfig {
  /** Enable wink-nlp sentence splitting (requires wink-nlp + wink-eng-lite-web-model). */
  useNLP: boolean;
  /** Minimum sentence length in characters. */
  minSentenceLength: number;
  /** Dedup tolerance in seconds for same-sentence detection. */
  dedupToleranceSec: number;
  /** Enable debug logging. */
  debug: boolean;
}

const DEFAULT_MERGER_CONFIG: UtteranceBasedMergerConfig = {
  useNLP: true,
  minSentenceLength: 1,
  dedupToleranceSec: 0.15,
  debug: false,
};

// ── Internal types ──────────────────────────────────────────────────────────

interface InternalWord {
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
  finalized: boolean;
}

interface FinalizedSentenceMeta {
  text: string;
  normalizedText: string;
  start_time: number;
  end_time: number;
}

const SENTENCE_END_RE = /[.!?]$/;

// ── Merger ──────────────────────────────────────────────────────────────────

export class UtteranceBasedMerger {
  private config: UtteranceBasedMergerConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nlp: any | null = null;

  // Mature (finalized) transcript
  private mergedTranscript: InternalWord[] = [];
  private cachedMatureText = "";
  private matureTextDirty = false;

  // Pending (immature) tail
  private lastImmatureWords: InternalWord[] = [];

  // Cursor tracking
  private matureCursorTime = 0;
  private finalizedSentencesMeta: FinalizedSentenceMeta[] = [];

  // UI-facing state
  private matureSentences: MergerSentence[] = [];
  private pendingSentence: MergerSentence | null = null;
  private sentenceSequence = 0;

  constructor(config: Partial<UtteranceBasedMergerConfig> = {}) {
    this.config = { ...DEFAULT_MERGER_CONFIG, ...config };
    this.initializeNLP();
  }

  // ── NLP initialization ──────────────────────────────────────────────────

  private initializeNLP(): void {
    if (!this.config.useNLP) {
      this.nlp = null;
      return;
    }
    try {
      this.nlp = winkNLP(model, ["sbd"]);
    } catch {
      if (this.config.debug) {
        console.warn("[UtteranceBasedMerger] wink-nlp not available, using heuristic splitter");
      }
      this.nlp = null;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Process one full ASR window result.
   * Returns updated mature/immature text.
   */
  processASRResult(asrResult: ASRResult): MergerResult {
    const incomingWords = this.normalizeWords(asrResult.words);
    if (incomingWords.length === 0) {
      return this.createResult(0, []);
    }

    const utteranceText = this.joinWords(incomingWords);
    const { sentences, detectionMethod } = this.splitSentences(utteranceText);

    if (this.config.debug) {
      console.debug(
        "[UtteranceBasedMerger] processASRResult:",
        JSON.stringify({
          utteranceLen: utteranceText.length,
          sentenceCount: sentences.length,
          detectionMethod,
          wordCount: incomingWords.length,
          sentences: sentences.map((s) => s.slice(0, 60)),
        }),
      );
    }

    const maturedThisCall: MergerSentence[] = [];

    if (sentences.length > 1) {
      const boundaries = this.mapSentencesToWordBoundaries(incomingWords, sentences);
      let prevIdx = 0;
      let lastConsumedIdx = 0;

      for (let si = 0; si < sentences.length - 1; si++) {
        const endIdx = boundaries[si] ?? prevIdx;
        const sentenceWords = incomingWords.slice(prevIdx, endIdx);
        prevIdx = endIdx;

        if (sentenceWords.length === 0) continue;

        const joined = this.joinWords(sentenceWords);
        const sentenceEnd = sentenceWords[sentenceWords.length - 1].end_time;

        if (this.isDuplicateSentence(joined, sentenceEnd)) {
          lastConsumedIdx = endIdx;
          continue;
        }

        const finalizedWords = sentenceWords.map((w) => ({ ...w, finalized: true }));
        const startWordIndex = this.mergedTranscript.length;
        this.mergedTranscript.push(...finalizedWords);
        this.matureTextDirty = true;

        const matureSentence = this.appendFinalizedSentence(
          joined,
          finalizedWords,
          startWordIndex,
          detectionMethod,
        );
        if (matureSentence) maturedThisCall.push(matureSentence);

        if (sentenceEnd > this.matureCursorTime) {
          this.matureCursorTime = sentenceEnd;
        }
        lastConsumedIdx = endIdx;
      }

      this.lastImmatureWords = incomingWords
        .slice(lastConsumedIdx)
        .map((w) => ({ ...w, finalized: false }));
    } else if (sentences.length === 1) {
      // Single sentence — always hold as pending/immature.
      // Overlapping windows will refine and eventually trigger multi-sentence
      // finalization when a following sentence appears.
      const singleText = this.joinWords(incomingWords);
      const singleEnd = incomingWords[incomingWords.length - 1].end_time;
      if (this.isDuplicateSentence(singleText, singleEnd)) {
        this.lastImmatureWords = [];
      } else if (
        // Don't replace a substantive pending text with garbage from a
        // nearly-silent window (single punctuation, very short fragments).
        this.lastImmatureWords.length > 0 &&
        incomingWords.length <= 1 &&
        /^[^a-zA-Z0-9]*$/.test(singleText)
      ) {
        // Keep existing pending text — this window's output is noise
      } else if (
        // Confirmed single sentence: the new window starts with the same
        // text as the current pending, and the pending was punctuation-complete.
        // This means the model has confirmed this text — finalize it.
        this.lastImmatureWords.length > 0 &&
        this.isSentenceComplete(this.joinWords(this.lastImmatureWords)) &&
        singleText.startsWith(this.joinWords(this.lastImmatureWords))
      ) {
        // Finalize the confirmed pending text
        const finalizedWords = this.lastImmatureWords.map((w) => ({ ...w, finalized: true }));
        const startWordIndex = this.mergedTranscript.length;
        this.mergedTranscript.push(...finalizedWords);
        this.matureTextDirty = true;

        const matureSentence = this.appendFinalizedSentence(
          this.joinWords(this.lastImmatureWords),
          finalizedWords,
          startWordIndex,
          detectionMethod,
        );
        if (matureSentence) maturedThisCall.push(matureSentence);

        const pendingEnd = finalizedWords[finalizedWords.length - 1].end_time;
        if (pendingEnd > this.matureCursorTime) {
          this.matureCursorTime = pendingEnd;
        }

        // Only keep the NEW portion (beyond the confirmed prefix) as pending.
        // If the new text is identical to the confirmed text, clear pending.
        const pendingPrefix = this.joinWords(this.lastImmatureWords);
        if (singleText.length > pendingPrefix.length) {
          // Find which incoming words are new (beyond the confirmed prefix)
          const newWords = incomingWords.slice(this.lastImmatureWords.length);
          if (newWords.length > 0) {
            this.lastImmatureWords = newWords.map((w) => ({ ...w, finalized: false }));
          } else {
            this.lastImmatureWords = [];
          }
        } else {
          this.lastImmatureWords = [];
        }
      } else {
        this.lastImmatureWords = incomingWords.map((w) => ({ ...w, finalized: false }));
      }
    } else {
      this.lastImmatureWords = incomingWords.map((w) => ({ ...w, finalized: false }));
    }

    this.updatePendingSentence();

    return this.createResult(sentences.length, maturedThisCall);
  }

  /**
   * Finalize the pending sentence if it ends with punctuation.
   * Returns the merger result if a sentence was finalized, null otherwise.
   */
  finalizePendingSentenceByTimeout(): MergerResult | null {
    if (this.lastImmatureWords.length === 0) return null;

    const pendingText = this.joinWords(this.lastImmatureWords);
    if (!this.isSentenceComplete(pendingText)) return null;

    const pendingEnd = Math.max(...this.lastImmatureWords.map((w) => w.end_time));
    if (this.isDuplicateSentence(pendingText, pendingEnd)) {
      this.lastImmatureWords = [];
      this.pendingSentence = null;
      return null;
    }

    const finalizedWords = this.lastImmatureWords.map((w) => ({ ...w, finalized: true }));
    const startWordIndex = this.mergedTranscript.length;
    this.mergedTranscript.push(...finalizedWords);
    this.matureTextDirty = true;

    const matured = this.appendFinalizedSentence(
      pendingText,
      finalizedWords,
      startWordIndex,
      this.nlp ? "nlp" : "heuristic",
    );

    this.lastImmatureWords = [];
    this.pendingSentence = null;

    if (pendingEnd > this.matureCursorTime) {
      this.matureCursorTime = pendingEnd;
    }

    return this.createResult(1, matured ? [matured] : []);
  }

  /**
   * Force-finalize all pending text (called when recording stops).
   */
  forceFinalizeAll(): void {
    if (this.lastImmatureWords.length === 0) return;

    const pendingText = this.joinWords(this.lastImmatureWords);
    const pendingEnd = Math.max(...this.lastImmatureWords.map((w) => w.end_time));

    if (this.isDuplicateSentence(pendingText, pendingEnd)) {
      this.lastImmatureWords = [];
      this.pendingSentence = null;
      return;
    }

    const finalizedWords = this.lastImmatureWords.map((w) => ({ ...w, finalized: true }));
    const startWordIndex = this.mergedTranscript.length;
    this.mergedTranscript.push(...finalizedWords);
    this.matureTextDirty = true;

    this.appendFinalizedSentence(
      pendingText,
      finalizedWords,
      startWordIndex,
      this.nlp ? "nlp" : "heuristic",
    );

    this.lastImmatureWords = [];
    this.pendingSentence = null;

    if (pendingEnd > this.matureCursorTime) {
      this.matureCursorTime = pendingEnd;
    }
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  getMatureText(): string {
    if (this.matureTextDirty) {
      this.cachedMatureText = this.joinWords(this.mergedTranscript);
      this.matureTextDirty = false;
    }
    return this.cachedMatureText;
  }

  getImmatureText(): string {
    return this.joinWords(this.lastImmatureWords);
  }

  getFullText(): string {
    const mature = this.getMatureText();
    const immature = this.getImmatureText();
    if (mature && immature) return `${mature} ${immature}`.trim();
    return mature || immature || "";
  }

  getMatureCursorTime(): number {
    return this.matureCursorTime;
  }

  getPendingSentence(): MergerSentence | null {
    return this.pendingSentence;
  }

  reset(): void {
    this.mergedTranscript = [];
    this.cachedMatureText = "";
    this.matureTextDirty = false;
    this.lastImmatureWords = [];
    this.matureCursorTime = 0;
    this.finalizedSentencesMeta = [];
    this.matureSentences = [];
    this.pendingSentence = null;
    this.sentenceSequence = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private normalizeWords(words?: ASRWord[]): InternalWord[] {
    if (!Array.isArray(words)) return [];
    return words
      .map((w) => ({
        text: String(w?.text ?? "").trim(),
        start_time: Number(w?.start_time ?? 0),
        end_time: Number(w?.end_time ?? 0),
        confidence: Number.isFinite(Number(w?.confidence))
          ? Math.max(0, Math.min(1, Number(w?.confidence)))
          : 1.0,
        finalized: false,
      }))
      .filter((w) => w.text.length > 0)
      .map((w) => ({
        ...w,
        start_time: Math.max(0, w.start_time),
        end_time: Math.max(w.start_time, w.end_time),
      }));
  }

  private joinWords(words: InternalWord[]): string {
    return words.map((w) => w.text).join(" ").trim();
  }

  private normalizeSentenceText(value: string): string {
    return value.trim().toLowerCase();
  }

  private splitSentences(text: string): {
    sentences: string[];
    detectionMethod: "nlp" | "heuristic";
  } {
    const trimmed = text.trim();
    if (!trimmed) {
      return { sentences: [], detectionMethod: "heuristic" };
    }

    if (this.nlp) {
      try {
        const doc = this.nlp.readDoc(trimmed);
        const sentenceTexts: string[] = doc.sentences().out();
        const cleaned = sentenceTexts
          .map((s) => String(s).trim())
          .filter((s) => s.length > 0);
        if (cleaned.length > 0) {
          return { sentences: cleaned, detectionMethod: "nlp" };
        }
      } catch {
        // Fall through to heuristic
      }
    }

    // Heuristic: split on sentence-ending punctuation
    const heuristic = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [trimmed];
    return {
      sentences: heuristic.map((s) => s.trim()).filter((s) => s.length > 0),
      detectionMethod: "heuristic",
    };
  }

  private mapSentencesToWordBoundaries(
    words: InternalWord[],
    sentences: string[],
  ): number[] {
    const boundaries: number[] = [];
    let wordIdx = 0;

    for (const sentence of sentences) {
      const sentenceClean = sentence.replace(/\s+/g, "").toLowerCase();
      let accumulated = "";

      for (let i = wordIdx; i < words.length; i++) {
        accumulated += words[i].text.toLowerCase();
        if (accumulated.length >= sentenceClean.length) {
          wordIdx = i + 1;
          break;
        }
      }
      boundaries.push(wordIdx);
    }

    return boundaries;
  }

  private isDuplicateSentence(text: string, endTime: number): boolean {
    const norm = this.normalizeSentenceText(text);
    for (let i = this.finalizedSentencesMeta.length - 1; i >= 0; i--) {
      const meta = this.finalizedSentencesMeta[i];
      if (
        meta.normalizedText === norm &&
        Math.abs(meta.end_time - endTime) < this.config.dedupToleranceSec
      ) {
        return true;
      }
    }
    return false;
  }

  private isSentenceComplete(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.endsWith("...")) return false;
    return SENTENCE_END_RE.test(trimmed);
  }

  private appendFinalizedSentence(
    text: string,
    finalizedWords: InternalWord[],
    startWordIndex: number,
    detectionMethod: "nlp" | "heuristic",
  ): MergerSentence | null {
    if (finalizedWords.length === 0) return null;
    const startTime = finalizedWords[0].start_time;
    const endTime = finalizedWords[finalizedWords.length - 1].end_time;

    this.finalizedSentencesMeta.push({
      text,
      normalizedText: this.normalizeSentenceText(text),
      start_time: startTime,
      end_time: endTime,
    });

    const sentence: MergerSentence = {
      id: `sentence_${this.sentenceSequence++}`,
      text,
      startTime,
      endTime,
      isMature: true,
      detectionMethod,
    };
    this.matureSentences.push(sentence);
    return sentence;
  }

  private updatePendingSentence(): void {
    const startWordIndex = this.mergedTranscript.length;
    if (this.lastImmatureWords.length === 0) {
      this.pendingSentence = null;
      return;
    }

    const text = this.joinWords(this.lastImmatureWords);
    if (!text) {
      this.pendingSentence = null;
      return;
    }

    const startTime = this.lastImmatureWords[0].start_time;
    const endTime = this.lastImmatureWords[this.lastImmatureWords.length - 1].end_time;

    this.pendingSentence = {
      id: `pending_${this.sentenceSequence}`,
      text,
      startTime,
      endTime,
      isMature: false,
      detectionMethod: this.nlp ? "nlp" : "heuristic",
    };
  }

  private createResult(
    totalSentences: number,
    matureSentences: MergerSentence[],
  ): MergerResult {
    return {
      matureText: this.getMatureText(),
      immatureText: this.getImmatureText(),
      fullText: this.getFullText(),
      matureCursorTime: this.matureCursorTime,
      totalSentences,
      allMatureSentences: [...this.matureSentences],
      pendingSentence: this.pendingSentence,
    };
  }
}
