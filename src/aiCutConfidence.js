// AI-cut confidence (FB-24 / P1-33): every cut an AI detector proposes
// carries a 0..1 confidence and a plain-language reason, so the review step
// can show which cuts are safe and which are guesses — instead of applying
// them blind. The scores are deliberately coarse and documented, not
// precision claims: they rank evidence the detectors already have.
//
//   silence — longer silent spans are likelier to be real dead air than a
//             breath between words (duration vs the detection threshold).
//   filler  — an exact lexicon hit (um, يعني, …) is strong evidence; a
//             multi-word phrase is slightly weaker (one word may be real).
//   pause   — a longer gap between words is likelier to be dead air.
//   retake  — the textual similarity between the removed take and the kept
//             take (takeSimilarity): near-identical lines are safe to drop.
//
// This is NOT motion-tracking confidence (electron/track.cjs): that `c`
// field scores a tracked point's visual match. Nothing here reads it.
import { mergeRanges, normalizeTakeWords, takeSimilarity } from './transcript.js';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Silence: 0.55 at the detection floor, rising to 1.0 at floor + 1.3 s.
// A 0.2 s blip just over the threshold is a coin flip; a 1.5 s+ hole is not.
export function silenceConfidence(durationSec, minDur = 0.6) {
  const d = Math.max(0, durationSec - Math.max(0, minDur - 0.4));
  return clamp01(0.55 + (0.45 * d) / 1.3);
}

export function scoreSilenceRanges(ranges, { minDur = 0.6 } = {}) {
  return (ranges || []).map((r) => {
    const dur = r.end - r.start;
    return {
      ...r,
      kind: 'silence',
      confidence: silenceConfidence(dur, minDur),
      reason: `silence ${dur.toFixed(1)}s`,
    };
  });
}

// Filler words: an exact lexicon match is 0.90; a phrase (you know, tu
// vois) is 0.85 — one word of the phrase may be real speech. Pauses reuse
// the gap: 0.55 at the threshold, +0.25 per extra second, capped at 0.95.
export function scoreFillerDetection(found, { minPause = 0.7 } = {}) {
  const details = found?.details || [];
  return details.map((d) => {
    if (d.kind === 'pause') {
      const gap = d.gap ?? (d.end - d.start + 0.3);
      return { ...d, confidence: clamp01(0.55 + (gap - minPause) * 0.25), reason: `pause ${gap.toFixed(1)}s` };
    }
    if (d.kind === 'phrase') {
      return { ...d, confidence: 0.85, reason: `filler phrase “${d.word || ''}”` };
    }
    return { ...d, confidence: 0.9, reason: `filler “${d.word || ''}”` };
  });
}

// Retake: similarity between the removed take and the kept take, mapped
// 0.55 (grouping floor) -> 0.60, 1.0 -> 1.0. A cut-off attempt (a strict
// subset of the kept line) is the safest kind of removal and is named.
export function scoreRetakeCuts(sentences, group) {
  const keeper = sentences[group.keep];
  return group.members
    .filter((i) => i !== group.keep)
    .map((i) => {
      const s = sentences[i];
      const similarity = takeSimilarity(normalizeTakeWords(s?.text), normalizeTakeWords(keeper?.text));
      const words = (s?.text || '').split(/\s+/).filter(Boolean).length;
      const keepWords = (keeper?.text || '').split(/\s+/).filter(Boolean).length;
      const cutoff = keepWords > 0 && words < keepWords;
      return {
        start: s.start,
        end: s.end,
        kind: 'retake',
        confidence: clamp01(0.6 + (0.4 * Math.max(0, similarity - 0.55)) / 0.45),
        reason: cutoff ? 'cut-off attempt of the kept take' : 'repeat of the kept take',
        similarity,
      };
    });
}

// Keep only cuts at or above the review threshold (default: show all).
export const applyThreshold = (cuts, min = 0) => (cuts || []).filter((c) => (c.confidence ?? 0) >= min);

// Accepted cuts, merged into the ranges cutRanges takes.
export function acceptedRanges(cuts) {
  return mergeRanges((cuts || []).filter((c) => c.accepted !== false).map(({ start, end }) => ({ start, end })));
}
