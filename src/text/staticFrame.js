// Static-frame detection for the text export (pure logic, no DOM).
//
// A frame of the text layer is PROVABLY unchanged from the previous frame when
// every visible clip is settled (its In animation has finished, its Out
// animation has not started, it has no loop animation and no motion pin) and
// every time-dependent highlight is in a discrete state whose index is part of
// the signature below. When the signature of frame i equals the signature of
// frame i-1, the drawn pixels are identical, so the exporter can reuse the
// { same: n } run mechanism instead of redrawing and diffing a full frame.
//
// Anything this module cannot prove static returns null (never static):
// karaoke sweeps (continuous), reveal/single highlights still inside their
// ease window, pinned (motion-tracked) clips, loop animations, and legacy
// `anim` clips whose timing model differs.

const DEFAULT_ANIM_IN = { id: 'fade', dur: 0.3 };
const DEFAULT_ANIM_OUT = { id: 'fade', dur: 0.25 };

import { resolveDuo, duoSettledAt, wordsOf, graphemes, isRtl, splitDuoText } from './duo.js';

// Word timings the renderer uses for a clip: its own word list when it matches
// the word count, otherwise an even split of the clip duration.
function wordTimes(clip, n) {
  if (Array.isArray(clip.words) && clip.words.length === n) return clip.words;
  const d = (clip.duration || 0) / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ start: i * d, end: (i + 1) * d }));
}

function activeIndex(times, lt) {
  let a = -1;
  for (let i = 0; i < times.length; i++) if (times[i].start <= lt) a = i;
  return a;
}

// Signature of one clip at local time lt, or null when it may be moving.
export function clipStaticSignature(clip, lt) {
  if (!clip || clip.pin) return null;
  // Gap-build C graphics: a VECTOR graphic clip's pixels are driven by local
  // time itself (progress ring/bar with progress null, number counter,
  // countdown, pointer pulse, dot-grid wave, stroke draw-on, scrolling
  // credits), so a "settled" clip is NOT a static frame — returning a
  // constant signature here froze the ring at the value it had when the last
  // plain text clip ended (export probe: 67% stuck from t=2.5s). Only the
  // panel kind is time-independent, so only it may prove static. The
  // CC-06 kinds (title, lowerThird, label, callout, boxpop, twoline) are
  // NOT vector kinds: they settle with animIn/animOut like normal text
  // clips (checked below), so the early return must name the vector kinds
  // instead of excluding only 'panel' — the blanket form also caught the
  // CC-06 kinds and broke test-cc06-graphics.
  const TIME_DRIVEN_VECTOR_KINDS = ['credits', 'stroke-draw-on', 'progress-ring', 'number-counter', 'countdown-timer', 'progress-bar', 'pointer-highlight', 'kinetic-dot-grid'];
  if (clip.graphic && TIME_DRIVEN_VECTOR_KINDS.includes(clip.graphic.kind)) return null;
  // A duo clip animates per word / per char long after its (none) block anims
  // are done: it is only settled in its hold window, between the last unit
  // finishing and the exit starting. Anything else returns null (not static).
  if (clip.duo) {
    const duo = resolveDuo(clip.duo);
    const { line1, line2 } = splitDuoText(clip.text);
    const n1 = wordsOf(line1).length;
    const rtl2 = isRtl(line2);
    const n2 = line2 ? (rtl2 ? wordsOf(line2).length : graphemes(line2).length) : 0;
    const step2 = rtl2 ? duo.line2.wordMs : duo.line2.charMs;
    return duoSettledAt(duo, n1, n2, step2, clip.duration * 1000, lt * 1000) ? `${clip.id}|duo` : null;
  }
  // A graphic clip (CC-06) whose value moves on every frame — a counting
  // number, a ticking timer, a filling ring — is never static. The other
  // kinds settle with their animIn/animOut (their internal reveals are
  // driven by pIn and end exactly when the entrance ends), so the standard
  // settled logic below applies to them unchanged.
  if (clip.graphic) {
    const kind = (clip.graphic && clip.graphic.kind) || 'title';
    if (kind === 'number' || kind === 'timer' || kind === 'ring') return null;
  }
  if (clip.animIn === undefined && clip.anim !== undefined && clip.anim !== 'none') return null;
  const animIn = { ...DEFAULT_ANIM_IN, ...(clip.animIn || {}) };
  const animOut = { ...DEFAULT_ANIM_OUT, ...(clip.animOut || {}) };
  const animLoop = clip.animLoop || { id: 'none' };
  if (animLoop.id && animLoop.id !== 'none') return null;
  const settledIn = animIn.id === 'none' || !(animIn.dur > 0) || lt >= animIn.dur;
  const settledOut = animOut.id === 'none' || !(animOut.dur > 0) || (clip.duration - lt) >= animOut.dur;
  if (!settledIn || !settledOut) return null;
  const hl = clip.highlight || { mode: 'none' };
  const mode = hl.mode || 'none';
  if (mode === 'karaoke') return null; // the sweep moves continuously inside a word
  let active = -1;
  if (mode !== 'none') {
    const words = String(clip.text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return `${clip.id}|-1`;
    const times = wordTimes(clip, words.length);
    active = activeIndex(times, lt);
    // 'reveal' / 'single' ease the active word in over ~0.15 s / 0.12 s after it
    // starts; inside that window (and before the first word) the frame moves.
    if (mode === 'reveal' || mode === 'single') {
      if (active < 0) return null;
      if (lt - (times[active].start || 0) < 0.2) return null;
    }
  }
  return `${clip.id}|${active}`;
}

// Signature of the whole text layer at timeline time t, or null when any
// visible clip may be moving (or no clip is visible — the caller's blank-run
// path handles that case).
export function textLayerSignature(project, t) {
  const parts = [];
  for (const c of project.textClips || []) {
    if (!(t >= c.start && t < c.start + c.duration)) continue;
    const sig = clipStaticSignature(c, t - c.start);
    if (sig === null) return null;
    parts.push(sig);
  }
  return parts.length ? parts.join(';') : null;
}
