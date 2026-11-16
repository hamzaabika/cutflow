// Canonical edit-interval math (gap-build Stream E, TL-01 / Doc A A-F1;
// merged onto CC master: ONE helper, normalizeCutRanges).
//
// Every command that takes timeline ranges — cutRanges, cutFreeRanges,
// moveRanges, silence/filler/retake cuts, ripple shifts — must agree on what
// a set of ranges MEANS. Before this module, each call site sorted (or not)
// and summed on its own: cutRanges sorted but never merged, so two
// overlapping ranges double-counted in cutBefore (rippleTextClips,
// moveTextClips) and in moveRanges' blockLen — the same second of timeline
// removed twice. subtractRanges was union-correct for clip pieces, so the
// picture looked right while the text/audio shift was wrong.
//
// The rule, in one place: normalizeCutRanges sorts, drops slivers, clips to
// [0, duration] and merges overlapping / touching ranges. Every range-taking
// command normalizes FIRST, then derives everything (cutBefore, blockLen,
// pieces) from the normalized list. This is the same helper store.js used
// to define locally (CC FB-02, P1-01); it lives here now so intervals.js
// and store.js share one implementation, and store.js re-exports it.
export const CUT_EPS = 1e-6;
export const MIN_CUT = 0.01;

// Sort + merge overlapping / touching ranges; drop slivers shorter than
// MIN_CUT; clip to [0, duration]. Input ranges are { start, end }
// (numbers); output is a fresh array of { start, end } in ascending,
// non-overlapping order. duration may be omitted (Infinity).
export function normalizeCutRanges(ranges, duration) {
  if (!Array.isArray(ranges)) return [];
  const max = Number.isFinite(duration) ? Math.max(0, duration) : Infinity;
  const kept = [];
  for (const r of ranges) {
    if (!r || !Number.isFinite(r.start) || !Number.isFinite(r.end)) continue;
    const start = Math.max(0, r.start);
    const end = Math.min(max, r.end);
    if (end - start <= MIN_CUT) continue;
    kept.push({ start, end });
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const r of kept) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + CUT_EPS) {
      if (r.end > last.end) last.end = r.end;
    } else merged.push({ ...r });
  }
  return merged;
}

// Total timeline time removed by a (possibly overlapping) set of ranges —
// the overlap is counted once, by construction.
export function totalRemoved(ranges) {
  return normalizeCutRanges(ranges).reduce((n, r) => n + (r.end - r.start), 0);
}

// cutBefore(t): how much timeline time before t is removed by the ranges.
// Built from the NORMALIZED list, so overlapping ranges never double-count
// (the old inline versions summed each range independently).
export function cutBeforeFn(ranges) {
  const cuts = normalizeCutRanges(ranges);
  return (t) => cuts.reduce((n, r) => n + (t > r.start ? Math.max(0, Math.min(r.end, t) - r.start) : 0), 0);
}

// True when two range lists cover the same timeline time (after
// normalization) — for tests / dedupe checks.
export function sameCoverage(a, b) {
  const na = normalizeCutRanges(a);
  const nb = normalizeCutRanges(b);
  return na.length === nb.length && na.every((r, i) => Math.abs(r.start - nb[i].start) <= CUT_EPS && Math.abs(r.end - nb[i].end) <= CUT_EPS);
}
