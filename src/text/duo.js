// Neon Pop Duo — pure timing / segmentation / spec logic for the duo caption preset.
// DOM-free on purpose: src/text/render.js draws with it, src/text/staticFrame.js
// proves export frames static with it, and the node test suites import it directly.
// Nothing here reads the clock or unseeded randomness: same inputs, same outputs.

export const DUO_EASE = [0.22, 1, 0.36, 1]; // cubic-bezier(.22,1,.36,1) for every entry ramp

// The full preset spec. Every visual and timing value lives here so a variant
// (other colours, fonts, speeds) is a clone of the catalog entry, no code change.
export const DEFAULT_DUO = {
  seed: 7,
  speed: 1.0, // global multiplier: divides every duration below
  glowScale: 1.0, // multiplies entry-glow blur and resting-glow alpha
  lightMode: false, // blur -> opacity + scale only
  hardCut: false, // exit is an instant cut instead of a 100 ms fade
  bounce: false, // drop-bounce entrance on line-1 words (word drops from above, lands, bounces once); off by default
  videoBlurTransition: false, // reserved (out of scope): blur the video under the caption
  layout: { anchorY: 0.6, maxWidth: 0.9, lineGap: 0.15, minScale: 0.7 },
  line1: {
    font: 'inter', bold: false, italic: false,
    sizeRel: 0.055, // 5.5% of video width
    letterSpacing: -0.01, lineHeight: 1.1,
    color: '#FFFFFF',
    restGlow: { color: '#FFFFFF', blur: 6, alpha: 0.35 },
    enterGlow: { color: '#FF4D6D', blur: 14 },
    stagger: 120, enterDur: 280, glowDur: 320, floatDur: 350, floatAmp: 0.18, firstGlow: 1.5,
    dropHeight: 0.55, // drop-bounce (bounce on): word starts this far ABOVE the resting baseline, in em
    dropVar: 0.1, // seeded variation of the drop height, ±em per word (every word still starts well above the line)
    dropFallDur: 300, // drop-bounce: gravity fall to the baseline, ms
    dropBounceDur: 250, // drop-bounce: one damped bounce after landing, ms (total entry 550 ms)
  },
  line2: {
    font: 'playfairbi', bold: true, italic: true,
    sizeRel: 1.15, // x line-1 size
    letterSpacing: -0.02, lineHeight: 1.1,
    color: '#E10600',
    restGlow: { color: '#E10600', blur: 8, alpha: 0.45 },
    enterGlow: { color: '#FF1A1A', blur: 12 },
    startDelay: 150, charMs: 35, charDur: 200, glowDur: 200, wordMs: 120,
  },
  exit: { holdEnd: 120, dur: 100 },
  // Italic never applies to Arabic: line 1 is Cairo Medium (regular 500,
  // hence bold1 false) and line 2 is Aref Ruqaa Bold (700, hence bold2 true).
  rtl: { font1: 'cairomed', font2: 'arefruqaa', bold1: false, bold2: true },
};

// Deep-merges a partial duo spec onto the defaults (one level per named sub-object).
export function resolveDuo(partial) {
  const d = { ...DEFAULT_DUO, ...(partial || {}) };
  d.layout = { ...DEFAULT_DUO.layout, ...((partial || {}).layout || {}) };
  d.line1 = { ...DEFAULT_DUO.line1, ...((partial || {}).line1 || {}) };
  d.line1.restGlow = { ...DEFAULT_DUO.line1.restGlow, ...(((partial || {}).line1 || {}).restGlow || {}) };
  d.line1.enterGlow = { ...DEFAULT_DUO.line1.enterGlow, ...(((partial || {}).line1 || {}).enterGlow || {}) };
  d.line2 = { ...DEFAULT_DUO.line2, ...((partial || {}).line2 || {}) };
  d.line2.restGlow = { ...DEFAULT_DUO.line2.restGlow, ...(((partial || {}).line2 || {}).restGlow || {}) };
  d.line2.enterGlow = { ...DEFAULT_DUO.line2.enterGlow, ...(((partial || {}).line2 || {}).enterGlow || {}) };
  d.exit = { ...DEFAULT_DUO.exit, ...((partial || {}).exit || {}) };
  d.rtl = { ...DEFAULT_DUO.rtl, ...((partial || {}).rtl || {}) };
  return d;
}

// Deterministic PRNG (mulberry32). Seed = preset seed + word index, so the same
// word always floats the same way in preview and export.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded baseline offset for word i, in [-amp, +amp] (fractions of an em).
export function seededFloat(seed, i, amp = 0.18) {
  return (mulberry32((seed + i) >>> 0)() * 2 - 1) * amp;
}

// Standard cubic-bezier easing solver (Newton + bisection fallback).
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.max(0, Math.min(1, t)));
  };
}

export const easeDuo = cubicBezier(...DUO_EASE);

// Drop-bounce for a line-1 word in bounce mode (dy in em; canvas y grows
// downward, so positive = below the resting baseline): the word starts ABOVE
// the baseline at startEm (negative, about −0.55 em), falls with gravity
// (ease-in, accelerating) to the baseline, then bounces once — overshoot
// below, rebound above — and settles. NO scale pop anywhere: scale stays
// 1.0 through the whole entry. q spans the whole entry (fall + bounce);
// fallFrac is the fall share of the entry (300/550 by default).
// The damped bounce sin(2πv)·exp(−1.96v) peaks at 0.643× its amplitude and
// troughs at −0.241× it, so amplitude 0.1245 em gives the +0.08 em overshoot
// below the baseline and the −0.03 em rebound the spec asks for, and it is
// exactly 0 again at v = 1.
export function dropBounceDy(q, startEm, fallFrac = 300 / 550) {
  const t = clamp01(q);
  if (t <= fallFrac) {
    const u = t / fallFrac;
    return startEm * (1 - u * u); // gravity fall: accelerates down to 0
  }
  const v = (t - fallFrac) / (1 - fallFrac);
  return 0.1245 * Math.sin(2 * Math.PI * v) * Math.exp(-1.96 * v);
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function hexRgb(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(a, b, t) {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  return [Math.round(lerp(ca[0], cb[0], t)), Math.round(lerp(ca[1], cb[1], t)), Math.round(lerp(ca[2], cb[2], t))];
}

export function rgbaStr(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function rgbaArr(rgb, a) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// ---------- Segmentation (grapheme-safe, bidi-safe) ----------

let _segmenter = null;
function segmenter() {
  if (_segmenter === undefined) {
    try {
      _segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
    } catch {
      _segmenter = null;
    }
  }
  return _segmenter;
}

export function graphemes(text) {
  const s = segmenter();
  if (s) return [...s.segment(text)].map((x) => x.segment);
  return [...(text || '')];
}

export function wordsOf(text) {
  return (text || '').split(/\s+/).filter(Boolean);
}

export const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
export function isRtl(text) {
  return RTL_RE.test(text || '');
}

// Split clip text into the duo's two lines: first line is line 1, the rest
// (joined with a space) is line 2. A single line means line 2 is empty.
export function splitDuoText(text) {
  const parts = (text || '').split('\n');
  return { line1: parts[0] || '', line2: parts.slice(1).join(' ').trim() };
}

// Grapheme index where each word of `text` starts (one slot per word separator,
// so a typing step lands on the space between words too).
export function wordGraphemeStarts(text) {
  const words = wordsOf(text);
  const starts = [];
  let at = 0;
  for (const w of words) {
    starts.push(at);
    at += graphemes(w).length + 1;
  }
  return starts;
}

// ---------- Timing (all ms; pure, testable) ----------

// n1 = line-1 words; n2 = line-2 units (graphemes for Latin, words for RTL);
// step2 = per-unit step of line 2 (charMs for Latin, wordMs for RTL).
// Returns the full schedule after short-clip compression: stagger and typing
// speed shrink so the last unit finishes at least 300 ms before the exit.
export function duoTiming(duo, n1, n2, step2, durationMs) {
  const speed = Math.max(0.2, duo.speed || 1);
  const stagger = duo.line1.stagger / speed;
  const enterDur = duo.line1.enterDur / speed;
  const charDur = duo.line2.charDur / speed;
  const delay = duo.line2.startDelay / speed;
  const step = step2 / speed;
  const exitStart = durationMs - duo.exit.holdEnd;
  const needFinishBy = exitStart - 300;

  const finishWith = (k) => {
    const l1End = n1 > 0 ? (n1 - 1) * stagger * k + enterDur : 0;
    const l2End = n2 > 0 ? l1End + delay + (n2 - 1) * step * k + charDur : l1End;
    return { l1End, l2End };
  };
  let scale = 1;
  const plain = finishWith(1);
  const finish = n2 > 0 ? plain.l2End : plain.l1End;
  if (finish > needFinishBy && needFinishBy > 0) {
    // Solve k so the finish lands on needFinishBy, compressing only the stagger
    // and the typing step (entry durations stay put).
    const denom = (n1 - 1) * stagger + (n2 > 0 ? (n2 - 1) * step : 0);
    const numer = needFinishBy - enterDur - (n2 > 0 ? delay + charDur : 0);
    scale = denom > 0 ? Math.max(0.1, Math.min(1, numer / denom)) : 1;
  }
  const t = finishWith(scale);
  // Drop-bounce window (bounce mode only): fall + one damped bounce. Scales
  // with speed like every other duration; the fall share is the fall/bounce
  // split of the entry. Defaults guard callers that pass a partial spec.
  const dropFall = duo.line1.dropFallDur ?? 300;
  const dropBnc = duo.line1.dropBounceDur ?? 250;
  return {
    scale,
    stagger: stagger * scale,
    step: step * scale,
    enterDur,
    charDur,
    glowDur1: duo.line1.glowDur / speed,
    floatDur: duo.line1.floatDur / speed,
    glowDur2: duo.line2.glowDur / speed,
    dropDur: (dropFall + dropBnc) / speed,
    dropFallFrac: dropFall / (dropFall + dropBnc),
    line1End: t.l1End,
    line2Start: t.l1End + delay,
    line2End: t.l2End,
    exitStart,
    exitDur: duo.exit.dur,
  };
}

// Is the duo fully settled (hold, nothing moving) at local time ltMs?
export function duoSettledAt(duo, n1, n2, step2, durationMs, ltMs) {
  const t = duoTiming(duo, n1, n2, step2, durationMs);
  return ltMs >= t.line2End && ltMs < t.exitStart;
}
