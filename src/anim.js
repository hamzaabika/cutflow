// Clip animations (In / Out / Combo) and keyframes for picture clips (main track and overlay).
//
// The motion of a clip at a local time (seconds since the clip starts on the timeline) is its transform and
// opacity, keyframed or not, combined with its animation. The player calls stateAt() every frame; the export
// samples the same function (motionCurves) and FFmpeg follows those curves (electron/layers.cjs), so both show
// the same movement. No DOM here: tests import this file directly.

import { DEFAULT_TRANSFORM } from './visual.js';
import { easeValue } from './fx/easing.js';
import { clipDuration, hasCurve, sourceOffsetAt, speedAtTime, timelineOffsetAt } from './speedCurve.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const outCubic = (p) => 1 - (1 - p) ** 3;
const inOutSine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
const outBack = (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
function outBounce(p) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

// What an animation adds on top of the clip's own transform: scale and opacity multiply, x / y (fractions of the
// frame) and r (degrees) add.
const REST = { s: 1, x: 0, y: 0, r: 0, o: 1 };

// In animations. p goes from 0 (start of the animation) to 1 (the clip at rest). Out animations run them backwards
// (p from 1 to 0), so each one is written once.
const MOVES = {
  fade: (p) => ({ o: p }),
  grow: (p) => ({ s: 0.5 + 0.5 * outCubic(p), o: clamp01(p * 2) }),
  shrink: (p) => ({ s: 1.6 - 0.6 * outCubic(p), o: clamp01(p * 2) }),
  fromRight: (p) => ({ x: 1 - outCubic(p) }),
  fromLeft: (p) => ({ x: outCubic(p) - 1 }),
  fromBottom: (p) => ({ y: 1 - outCubic(p) }),
  fromTop: (p) => ({ y: outCubic(p) - 1 }),
  // Smooth slides: a shorter glide eased at both ends, with a soft fade — the "smooth" feel of pro preset packs.
  smoothFromRight: (p) => ({ x: 0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromLeft: (p) => ({ x: -0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromBottom: (p) => ({ y: 0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  smoothFromTop: (p) => ({ y: -0.45 * (1 - inOutSine(p)), o: clamp01(p * 1.6) }),
  spin: (p) => ({ r: -180 * (1 - outCubic(p)), s: 0.3 + 0.7 * outCubic(p), o: clamp01(p * 2) }),
  pop: (p) => ({ s: Math.max(0.01, outBack(p)), o: clamp01(p * 3) }),
  drop: (p) => ({ y: outBounce(p) - 1 }),
  swing: (p) => ({ r: 25 * (1 - p) * Math.cos(p * Math.PI * 3.5), o: clamp01(p * 4) }),
  shake: (p) => ({ x: 0.05 * (1 - p) * Math.sin(p * Math.PI * 12), o: clamp01(p * 4) }),
  rock: (p) => ({ y: 0.06 * (1 - p) * Math.sin(p * Math.PI * 10), o: clamp01(p * 4) }),
  twist: (p) => ({ r: 90 * (1 - outCubic(p)), s: 1.4 - 0.4 * outCubic(p), o: clamp01(p * 2) }),
};

// Combo animations play over the whole clip. lt: local time (s), len: clip length (s).
const COMBOS = {
  pulse: (lt) => ({ s: 1 + 0.06 * Math.sin(lt * Math.PI * 2.5) }),
  heartbeat: (lt) => ({ s: 1 + 0.1 * Math.max(0, Math.sin(lt * Math.PI * 2.4)) ** 6 }),
  wobble: (lt) => ({ r: 6 * Math.sin(lt * Math.PI * 2) }),
  sway: (lt) => ({ x: 0.03 * Math.sin(lt * Math.PI * 1.2), r: 2.5 * Math.sin(lt * Math.PI * 1.2 + 0.6) }),
  vibrate: (lt) => ({ x: 0.012 * Math.sin(lt * 47), y: 0.012 * Math.sin(lt * 39 + 1) }),
  bounce: (lt) => ({ y: -0.06 * Math.abs(Math.sin(lt * Math.PI * 1.8)) }),
  kenburns: (lt, len) => ({ s: 1 + 0.18 * inOutSine(clamp01(lt / len)) }),
  pullback: (lt, len) => ({ s: 1.18 - 0.18 * inOutSine(clamp01(lt / len)) }),
  driftRight: (lt, len) => ({ s: 1.12, x: -0.04 + 0.08 * inOutSine(clamp01(lt / len)) }),
  orbit: (lt, len) => ({ r: 360 * inOutSine(clamp01(lt / len)), s: 1 - 0.25 * Math.sin(Math.PI * clamp01(lt / len)) }),
  // P2-18 handheld: irregular multi-frequency shake. The 1.03 base scale is
  // the coverage margin — |x| peaks at 0.013 and |r| at 0.6 deg, so the
  // picture never uncovers the frame.
  handheld: (lt) => ({
    s: 1.03,
    x: 0.008 * Math.sin(lt * 37) + 0.005 * Math.sin(lt * 61 + 1.3),
    y: 0.008 * Math.cos(lt * 43 + 0.7),
    r: 0.6 * Math.sin(lt * 29),
  }),
};

// The catalog shown in the Animation tab. move: entry of MOVES (in / out) or COMBOS (combo).
export const ANIMATIONS = {
  in: [
    { id: 'fade_in', name: 'Fade In', move: 'fade', cat: 'Basic' },
    { id: 'zoom_in', name: 'Zoom In', move: 'grow', cat: 'Basic' },
    { id: 'zoom_out_in', name: 'Zoom Out', move: 'shrink', cat: 'Basic' },
    { id: 'slide_left', name: 'Slide Left', move: 'fromRight', cat: 'Slide' },
    { id: 'slide_right', name: 'Slide Right', move: 'fromLeft', cat: 'Slide' },
    { id: 'slide_up', name: 'Slide Up', move: 'fromBottom', cat: 'Slide' },
    { id: 'slide_down', name: 'Slide Down', move: 'fromTop', cat: 'Slide' },
    { id: 'slide_up_smooth', name: 'Slide Up Smooth', move: 'smoothFromBottom', cat: 'Slide' },
    { id: 'slide_down_smooth', name: 'Slide Down Smooth', move: 'smoothFromTop', cat: 'Slide' },
    { id: 'slide_left_smooth', name: 'Slide Left Smooth', move: 'smoothFromRight', cat: 'Slide' },
    { id: 'slide_right_smooth', name: 'Slide Right Smooth', move: 'smoothFromLeft', cat: 'Slide' },
    { id: 'spin_in', name: 'Spin In', move: 'spin', cat: 'Spin' },
    { id: 'twist_in', name: 'Twist', move: 'twist', cat: 'Spin' },
    { id: 'pop_in', name: 'Pop', move: 'pop', cat: 'Bounce' },
    { id: 'drop_in', name: 'Drop', move: 'drop', cat: 'Bounce' },
    { id: 'swing_in', name: 'Swing', move: 'swing', cat: 'Vibration' },
    { id: 'shake_in', name: 'Shake', move: 'shake', cat: 'Vibration' },
    { id: 'rock_in', name: 'Rock Vertically', move: 'rock', cat: 'Vibration' },
  ],
  out: [
    { id: 'fade_out', name: 'Fade Out', move: 'fade', cat: 'Basic' },
    { id: 'zoom_out', name: 'Zoom Out', move: 'grow', cat: 'Basic' },
    { id: 'zoom_in_out', name: 'Zoom In', move: 'shrink', cat: 'Basic' },
    { id: 'slide_left_out', name: 'Slide Left', move: 'fromLeft', cat: 'Slide' },
    { id: 'slide_right_out', name: 'Slide Right', move: 'fromRight', cat: 'Slide' },
    { id: 'slide_up_out', name: 'Slide Up', move: 'fromTop', cat: 'Slide' },
    { id: 'slide_down_out', name: 'Slide Down', move: 'fromBottom', cat: 'Slide' },
    { id: 'slide_up_smooth_out', name: 'Slide Up Smooth', move: 'smoothFromTop', cat: 'Slide' },
    { id: 'slide_down_smooth_out', name: 'Slide Down Smooth', move: 'smoothFromBottom', cat: 'Slide' },
    { id: 'slide_left_smooth_out', name: 'Slide Left Smooth', move: 'smoothFromLeft', cat: 'Slide' },
    { id: 'slide_right_smooth_out', name: 'Slide Right Smooth', move: 'smoothFromRight', cat: 'Slide' },
    { id: 'spin_out', name: 'Spin Out', move: 'spin', cat: 'Spin' },
    { id: 'twist_out', name: 'Twist', move: 'twist', cat: 'Spin' },
    { id: 'pop_out', name: 'Pop', move: 'pop', cat: 'Bounce' },
    { id: 'swing_out', name: 'Swing', move: 'swing', cat: 'Vibration' },
    { id: 'shake_out', name: 'Shake', move: 'shake', cat: 'Vibration' },
    { id: 'rock_out', name: 'Rock Vertically', move: 'rock', cat: 'Vibration' },
  ],
  combo: [
    { id: 'pulse', name: 'Pulse', move: 'pulse', cat: 'Loop' },
    { id: 'heartbeat', name: 'Heartbeat', move: 'heartbeat', cat: 'Loop' },
    { id: 'wobble', name: 'Wobble', move: 'wobble', cat: 'Loop' },
    { id: 'sway', name: 'Sway', move: 'sway', cat: 'Loop' },
    { id: 'vibrate', name: 'Vibrate', move: 'vibrate', cat: 'Loop' },
    { id: 'bounce', name: 'Bounce', move: 'bounce', cat: 'Loop' },
    { id: 'kenburns', name: 'Slow Zoom In', move: 'kenburns', cat: 'Camera' },
    { id: 'pullback', name: 'Slow Zoom Out', move: 'pullback', cat: 'Camera' },
    { id: 'drift', name: 'Pan Right', move: 'driftRight', cat: 'Camera' },
    { id: 'orbit', name: 'Orbit', move: 'orbit', cat: 'Camera' },
    { id: 'handheld', name: 'Handheld Shake', move: 'handheld', cat: 'Camera' },
  ],
};
export const DEFAULT_ANIM_DURATION = 0.5;
export const animById = (kind, id) => ANIMATIONS[kind].find((a) => a.id === id) || null;

// The clip's animations, kept valid for its length: In and Out never overlap, a Combo replaces both.
export function animOf(clip, len) {
  const a = clip.anim || {};
  if (a.combo && animById('combo', a.combo.type)) return { combo: a.combo };
  const out = {};
  const inA = a.in && animById('in', a.in.type) ? a.in : null;
  const outA = a.out && animById('out', a.out.type) ? a.out : null;
  let di = inA ? Math.max(0.05, inA.duration ?? DEFAULT_ANIM_DURATION) : 0;
  let dout = outA ? Math.max(0.05, outA.duration ?? DEFAULT_ANIM_DURATION) : 0;
  if (di + dout > len && di + dout > 0) {
    const k = len / (di + dout);
    di *= k;
    dout *= k;
  }
  if (inA) out.in = { type: inA.type, duration: di };
  if (outA) out.out = { type: outA.type, duration: dout };
  return out;
}

// Animation part of the motion at local time lt.
export function animState(clip, lt, len) {
  const a = animOf(clip, len);
  const st = { ...REST };
  const mix = (m) => {
    if (m.s !== undefined) st.s *= m.s;
    if (m.o !== undefined) st.o *= m.o;
    if (m.x !== undefined) st.x += m.x;
    if (m.y !== undefined) st.y += m.y;
    if (m.r !== undefined) st.r += m.r;
  };
  if (a.combo) {
    mix(COMBOS[animById('combo', a.combo.type).move](lt, len));
    return st;
  }
  if (a.in && lt < a.in.duration) mix(MOVES[animById('in', a.in.type).move](clamp01(lt / a.in.duration)));
  if (a.out && lt > len - a.out.duration) mix(MOVES[animById('out', a.out.type).move](clamp01((len - lt) / a.out.duration)));
  return st;
}

// Preview of one animation alone, for the Animation tab tiles. p: 0..1 through the animation.
export function previewState(kind, id, p) {
  const a = animById(kind, id);
  if (!a) return { ...REST };
  if (kind === 'combo') return { ...REST, ...COMBOS[a.move](p * 2.4, 2.4) };
  return { ...REST, ...MOVES[a.move](kind === 'in' ? p : 1 - p) };
}

// ---- Keyframes ----
// clip.keyframes: { scale: [{ t, v }], x: [...], y: [...], rot: [...], opacity: [...] } sorted by t. t is in the
// clip's source time (seconds of the media, like clip.in / clip.out), so trimming, splitting or changing the speed
// keeps every keyframe on the same picture.
export const KEY_PROPS = ['scale', 'x', 'y', 'rot', 'opacity'];
// Local (timeline) <-> source time through the speed sampler: lt * speed for a
// constant clip, the curve integral for a ramped one — so keyframes stay glued
// to the same picture when a clip is ramped, exactly as they do at any speed.
export const sourceTime = (clip, lt) => (clip.in || 0) + sourceOffsetAt(clip, lt);
export const localTime = (clip, srcT) => timelineOffsetAt(clip, srcT - (clip.in || 0));

// How a value travels to a keyframe, stored on the keyframe it arrives at ({ t, v, e }), like Remotion's Easing.
// No `e` is linear, so older projects play as before. spring: Remotion's spring without bounce (critically
// damped); back: a small overshoot that settles. The ids below are the original set; segments can also carry
// a cubic-bezier preset id or a custom { p1x, p1y, p2x, p2y } object from fx/easing.js — segEase resolves all
// three vocabularies, and because the export samples stateAt (motionCurves), preview and export agree.
const SPRING_END = 1 - Math.exp(-7) * 8;
export const EASINGS = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inout: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  spring: (p) => (1 - Math.exp(-7 * p) * (1 + 7 * p)) / SPRING_END,
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
const segEase = (e, p) => {
  if (e == null) return p;
  if (typeof e === 'string' && EASINGS[e]) return EASINGS[e](p);
  return easeValue(e, p);
};

function interp(list, t) {
  if (t <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (t >= last.t) return last.v;
  let i = 1;
  while (list[i].t < t) i++;
  const a = list[i - 1];
  const b = list[i];
  return a.v + (b.v - a.v) * segEase(b.e, (t - a.t) / (b.t - a.t));
}

// ---- Segment easing (the curve editor's keyframe side) ----
// The next arrival keyframe after local time lt: the first key (any property) that has a predecessor in
// its own list and sits after the playhead. Its `e` eases the segment that leads into it.
export function nextArrival(clip, lt, fps = 30) {
  if (!clip.keyframes) return null;
  const tol = (0.5 / fps) * speedAtTime(clip, lt) + EPS;
  let best = null;
  for (const p of KEY_PROPS) {
    const list = clip.keyframes[p] || [];
    for (let i = 1; i < list.length; i++) {
      if (localTime(clip, list[i].t) > lt + tol && (best === null || list[i].t < best)) best = list[i].t;
    }
  }
  return best;
}
// The easing stored on that arrival (first property that has a key there), or undefined.
export function segmentEase(clip, lt, fps = 30) {
  const at = nextArrival(clip, lt, fps);
  if (at === null) return undefined;
  for (const p of KEY_PROPS) {
    const k = (clip.keyframes[p] || []).find((x) => Math.abs(x.t - at) <= EPS);
    if (k) return k.e;
  }
  return undefined;
}
// Patch writing `ease` onto every property's keyframe at that arrival (undefined/'linear' clears it).
export function setSegmentEase(clip, lt, ease, fps = 30) {
  const at = nextArrival(clip, lt, fps);
  if (at === null) return {};
  const keyframes = { ...(clip.keyframes || {}) };
  for (const p of KEY_PROPS) {
    const k = (keyframes[p] || []).find((x) => Math.abs(x.t - at) <= EPS);
    if (k) keyframes[p] = upsert(keyframes[p], at, k.v, ease === undefined ? 'linear' : ease);
  }
  return { keyframes };
}

export const hasKeys = (clip, prop) => !!clip.keyframes?.[prop]?.length;
export const hasAnyKeys = (clip) => KEY_PROPS.some((p) => hasKeys(clip, p));
export const hasMotion = (clip) => hasAnyKeys(clip) || !!(clip.anim && (clip.anim.in || clip.anim.out || clip.anim.combo));

// Transform values (scale, x, y, rot) and opacity at local time lt, keyframes applied, without the animation.
// skipSc: ignore keys the Smooth Cut recipe wrote (sc: true) — the A/B preview's
// "hard cut" side only; the export never passes it, so exports always include them.
export function baseAt(clip, lt, skipSc = false) {
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  const v = { scale: t.scale, x: t.x, y: t.y, rot: t.rot, opacity: clip.opacity === undefined ? 1 : clip.opacity };
  if (clip.keyframes) {
    const st = sourceTime(clip, lt);
    for (const p of KEY_PROPS) {
      if (!hasKeys(clip, p)) continue;
      const list = skipSc ? clip.keyframes[p].filter((k) => !k.sc) : clip.keyframes[p];
      if (list.length) v[p] = interp(list, st);
    }
  }
  return v;
}

// The full motion of a clip at local time lt: { transform (like clip.transform), opacity }.
// opts.skipSmoothCut forwards baseAt's sc skip (preview A/B only).
export function stateAt(clip, lt, len, opts) {
  const b = baseAt(clip, lt, opts && opts.skipSmoothCut);
  const a = animState(clip, lt, len);
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  return {
    transform: { ...t, scale: b.scale * a.s, x: b.x + a.x, y: b.y + a.y, rot: b.rot + a.r },
    opacity: Math.max(0, Math.min(1, b.opacity * a.o)),
  };
}

const EPS = 1e-4;
// Keyframe of `prop` at local time lt (within half a frame), or null.
export function keyAt(clip, prop, lt, fps = 30) {
  const st = sourceTime(clip, lt);
  const tol = (0.5 / fps) * speedAtTime(clip, lt) + EPS;
  return (clip.keyframes?.[prop] || []).find((k) => Math.abs(k.t - st) <= tol) || null;
}

// Times (local) of the clip's keyframes, for the given props, sorted and without duplicates.
export function keyTimes(clip, props = KEY_PROPS) {
  const set = new Set();
  props.forEach((p) => (clip.keyframes?.[p] || []).forEach((k) => set.add(Math.round(localTime(clip, k.t) * 1000) / 1000)));
  return [...set].sort((a, b) => a - b);
}

// Sets the keyframe at t; a keyframe replaced there keeps its easing unless `e` is given.
function upsert(list, t, v, e) {
  const old = (list || []).find((k) => Math.abs(k.t - t) <= EPS);
  const out = (list || []).filter((k) => k !== old);
  const ease = e ?? old?.e;
  out.push(ease && ease !== 'linear' ? { t, v, e: ease } : { t, v });
  return out.sort((a, b) => a.t - b.t);
}

// Adds (or replaces) keyframes of `props` at local time lt with the clip's current values there. Returns the patch.
// A keyframe created where none existed starts a new segment, which defaults to Smooth; replacing an existing
// keyframe keeps its easing (upsert with no `e`).
export function addKeys(clip, props, lt) {
  const b = baseAt(clip, lt);
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  props.forEach((p) => {
    const isNew = !(keyframes[p] || []).some((k) => Math.abs(k.t - st) <= EPS);
    keyframes[p] = upsert(keyframes[p], st, b[p], isNew ? 'smooth' : undefined);
  });
  return { keyframes };
}

// Moves every keyframe at local time `from` (any property) to local time `to`, like dragging a diamond on the
// timeline. A keyframe already at `to` is replaced. Returns the patch.
export function moveKeys(clip, from, to, fps = 30) {
  const st = sourceTime(clip, to);
  const keyframes = { ...(clip.keyframes || {}) };
  KEY_PROPS.forEach((p) => {
    const k = keyAt(clip, p, from, fps);
    if (k) keyframes[p] = upsert(keyframes[p].filter((x) => x !== k), st, k.v, k.e);
  });
  return { keyframes };
}

// Sets one keyframe of `prop` at local time lt with value v. Replacing a keyframe keeps its
// easing; a new keyframe starts a Smooth segment, like addKeys. Returns the patch.
export function setKey(clip, prop, lt, value, fps = 30) {
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  const old = (keyframes[prop] || []).find((k) => Math.abs(k.t - st) <= EPS);
  keyframes[prop] = upsert(keyframes[prop], st, value, old ? old.e : 'smooth');
  return { keyframes };
}

// Writes one keyframe at SOURCE time t with an explicit easing — the
// primitive for keyframe recipes (motion presets), which define keys at
// normalised positions and convert to source time themselves.
export function writeKey(keyframes, prop, t, v, e) {
  const out = { ...(keyframes || {}) };
  out[prop] = upsert(out[prop], t, v, e);
  return out;
}

// Moves one keyframe of `prop` from local time fromLt to toLt and sets its value, keeping the
// dragged key's easing (not a destination key's). A no-op move (same time) only changes the
// value. Returns the patch.
export function moveKey(clip, prop, fromLt, toLt, value, fps = 30) {
  const from = keyAt(clip, prop, fromLt, fps);
  const stFrom = sourceTime(clip, fromLt);
  const stTo = sourceTime(clip, toLt);
  const keyframes = { ...(clip.keyframes || {}) };
  keyframes[prop] = upsert(keyframes[prop], stTo, value, from?.e);
  if (from && Math.abs(stFrom - stTo) > EPS) {
    keyframes[prop] = keyframes[prop].filter((k) => Math.abs(k.t - stFrom) > EPS);
    if (!keyframes[prop].length) delete keyframes[prop];
  }
  return { keyframes };
}

// ---- Keyframe actions (P2-08) ----
// Bulk operations on a clip's keyframes, all in LOCAL time (seconds since the
// clip starts on the timeline) and converted to the stored source time through
// sourceTime/localTime, so they stay glued to the same picture on ramped clips
// exactly like setKey/moveKey. Every function returns a { keyframes } patch
// for dispatch('update') — one dispatch, one undo step — and never mutates
// the input clip. Keys that would land outside [0, len] are dropped, never
// clamped onto another key (clamping would corrupt the curve's shape).
const KEY_RANGES = {
  scale: [0.05, 4], x: [-1, 1], y: [-1, 1], rot: [-360, 360], opacity: [0, 1],
};
const clampKey = (p, v) => {
  const [lo, hi] = KEY_RANGES[p];
  return Math.min(hi, Math.max(lo, v));
};
// Rebuild one property's list from [localTime, value, ease] triples, dropping
// out-of-range times and merging collisions (later triple wins).
function rebuildProp(clip, p, triples) {
  const len = clipDuration(clip);
  const seen = new Map();
  for (const [lt, v, e] of triples) {
    if (lt < -EPS || lt > len + EPS) continue;
    const t = sourceTime(clip, Math.min(len, Math.max(0, lt)));
    seen.set(Math.round(t * 1e4), { t, v: clampKey(p, v), ...(e && e !== 'linear' ? { e } : {}) });
  }
  const list = [...seen.values()].sort((a, b) => a.t - b.t);
  return list;
}
function patchProps(clip, props, fn) {
  const keyframes = { ...(clip.keyframes || {}) };
  for (const p of props) {
    const list = fn(p, (clip.keyframes?.[p] || []).map((k) => ({ ...k, lt: localTime(clip, k.t) })));
    if (list && list.length) keyframes[p] = list;
    else delete keyframes[p];
  }
  return { keyframes };
}
const VALID_PROPS = (props) => (props || KEY_PROPS).filter((p) => KEY_PROPS.includes(p));

// The clipboard: a plain JSON object ({ version, props, origin }) held in this
// module so a copy survives selecting another clip. Times are LOCAL seconds
// relative to the first key (origin), values and easing travel with the key.
let kfClipboard = null;
export function setKeyframeClipboard(data) {
  kfClipboard = data && data.version === 1 && data.props ? data : null;
  return kfClipboard;
}
export function getKeyframeClipboard() { return kfClipboard; }
// Copy the clip's keyframes (or one property's) into the clipboard shape.
export function copyKeyframes(clip, props) {
  const ps = VALID_PROPS(props);
  const out = {};
  let origin = Infinity;
  for (const p of ps) {
    const list = (clip.keyframes?.[p] || []).map((k) => ({ lt: localTime(clip, k.t), v: k.v, e: k.e }));
    if (!list.length) continue;
    out[p] = list.map(({ lt, v, e }) => ({ t: lt, v, ...(e ? { e } : {}) }));
    origin = Math.min(origin, ...list.map((k) => k.lt));
  }
  if (!Object.keys(out).length) return null;
  const data = { version: 1, origin, props: out };
  // Store times relative to the origin so pasting lands the first key at the playhead.
  for (const p of Object.keys(out)) out[p] = out[p].map((k) => ({ ...k, t: Math.round((k.t - origin) * 1000) / 1000 }));
  return setKeyframeClipboard(data);
}
// Paste the clipboard at local time lt (first key lands there). mode 'merge'
// replaces keys at the pasted times; 'replace' clears the pasted properties
// first. Returns null for a bad clipboard (wrong shape, no keys).
export function pasteKeyframes(clip, data, lt, mode = 'merge') {
  if (!data || data.version !== 1 || !data.props || typeof data.props !== 'object') return null;
  const keyframes = { ...(clip.keyframes || {}) };
  let any = false;
  for (const [p, list] of Object.entries(data.props)) {
    if (!KEY_PROPS.includes(p) || !Array.isArray(list) || !list.length) continue;
    const base = mode === 'replace' ? [] : (keyframes[p] || []).map((k) => ({ t: k.t, v: k.v, e: k.e }));
    const triples = base.map((k) => [localTime(clip, k.t), k.v, k.e]);
    for (const k of list) {
      if (typeof k.t !== 'number' || typeof k.v !== 'number') continue;
      triples.push([lt + k.t, k.v, k.e]);
      any = true;
    }
    const rebuilt = rebuildProp(clip, p, triples);
    if (rebuilt.length) keyframes[p] = rebuilt;
    else delete keyframes[p];
  }
  return any ? { keyframes } : null;
}
// Mirror (reflect) every key's time about a pivot local time (default: the
// clip's midpoint). Values and easing stay attached to their key.
export function mirrorKeys(clip, props, pivotLt) {
  const len = clipDuration(clip);
  const pivot = pivotLt === undefined ? len / 2 : pivotLt;
  return patchProps(clip, VALID_PROPS(props), (p, keys) =>
    rebuildProp(clip, p, keys.map((k) => [2 * pivot - k.lt, k.v, k.e])));
}
// Reverse the VALUES of each property (times stay put): the motion plays
// backwards in value while keeping its rhythm.
export function reverseKeys(clip, props) {
  return patchProps(clip, VALID_PROPS(props), (p, keys) => {
    const values = keys.map((k) => k.v).reverse();
    return rebuildProp(clip, p, keys.map((k, i) => [k.lt, values[i], k.e]));
  });
}
// Duplicate every key shifted by offsetS local seconds (positive = later).
// Collisions with existing keys and out-of-range copies are skipped.
export function cloneKeys(clip, props, offsetS) {
  if (!offsetS) return { keyframes: { ...(clip.keyframes || {}) } };
  return patchProps(clip, VALID_PROPS(props), (p, keys) => {
    const triples = keys.map((k) => [k.lt, k.v, k.e]);
    for (const k of keys) {
      const nt = k.lt + offsetS;
      if (nt < 0 || nt > clipDuration(clip)) continue;
      if (keys.some((o) => Math.abs(o.lt - nt) <= EPS)) continue;
      triples.push([nt, k.v, k.e]);
    }
    return rebuildProp(clip, p, triples);
  });
}
// Shift every key by dt local seconds (negative = earlier). Keys pushed out
// of the clip are dropped.
export function shiftKeys(clip, props, dt) {
  if (!dt) return { keyframes: { ...(clip.keyframes || {}) } };
  return patchProps(clip, VALID_PROPS(props), (p, keys) =>
    rebuildProp(clip, p, keys.map((k) => [k.lt + dt, k.v, k.e])));
}
// Jitter every key's value by up to ±amount (0..1) of its property range, with
// a seeded PRNG so the same seed gives the same result (repeatable, undoable).
export function randomizeKeys(clip, props, amount = 0.3, seed = 1) {
  let s = (seed >>> 0) || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const JITTER = { scale: 0.5, x: 0.2, y: 0.2, rot: 30, opacity: 0.3 };
  return patchProps(clip, VALID_PROPS(props), (p, keys) =>
    rebuildProp(clip, p, keys.map((k) => [k.lt, k.v + (rnd() * 2 - 1) * amount * JITTER[p], k.e])));
}
// Snap every key within tol seconds of local time lt onto lt (aligns the
// properties' keys onto one instant, e.g. the playhead).
export function alignKeys(clip, props, lt, tol = 0.15) {
  return patchProps(clip, VALID_PROPS(props), (p, keys) =>
    rebuildProp(clip, p, keys.map((k) => [Math.abs(k.lt - lt) <= tol ? lt : k.lt, k.v, k.e])));
}
// Set the easing of the keys at local time lt (all properties, or the given
// ones). 'linear'/undefined clears it.
export function setKeysEase(clip, props, lt, ease, fps = 30) {
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  for (const p of VALID_PROPS(props)) {
    const list = keyframes[p];
    if (!list) continue;
    const k = list.find((x) => Math.abs(x.t - st) <= (0.5 / fps) * speedAtTime(clip, lt) + EPS);
    if (k) keyframes[p] = upsert(list, k.t, k.v, ease === undefined ? 'linear' : ease);
  }
  return { keyframes };
}

// ---- Duration-adaptive presets (P2-11) ----
// A preset's timing is designed for a length; when the clip gets shorter the
// preset must ADAPT, not just truncate (animOf already clamps in/out at read
// time, but the stored durations stay long, so the preset silently changes
// shape on the next edit). adaptClipPresets scales the stored in/out,
// text-anim and transition durations by the length ratio and reports what it
// could NOT adapt: keyframes are glued to the picture in source time, so
// keys past the new end become unreachable instead of rescaled; speed ramps
// and pinned followers keep their own timing. The report rides on the clip
// as `adaptReport` so the inspector can show it. Report entries are
// structured { key, params } — the inspector maps them to translated strings
// via t('prim.adapted' / 'prim.adaptUnhandled', { line: t(entry.key,
// entry.params) }); never put display text here.
export function adaptClipPresets(clip, oldLen, newLen) {
  const scaled = [];
  const unhandled = [];
  const patch = {};
  if (oldLen > 0 && newLen > 0 && Math.abs(newLen - oldLen) > 1e-6) {
    const ratio = newLen / oldLen;
    const scaleDur = (d0, min, max) => Math.min(max, Math.max(min, Math.round(d0 * ratio * 100) / 100));
    const a = clip.anim || {};
    const nextAnim = { ...a };
    let animChanged = false;
    for (const kind of ['in', 'out']) {
      if (a[kind] && typeof a[kind].duration === 'number') {
        const d1 = scaleDur(a[kind].duration, 0.05, newLen);
        if (d1 !== a[kind].duration) {
          nextAnim[kind] = { ...a[kind], duration: d1 };
          animChanged = true;
          scaled.push({ key: kind === 'in' ? 'prim.adaptAnimIn' : 'prim.adaptAnimOut', params: { from: a[kind].duration, to: d1 } });
        }
      }
    }
    // Both animations together must still fit: scale them down together.
    if (nextAnim.in && nextAnim.out && nextAnim.in.duration + nextAnim.out.duration > newLen) {
      const k = newLen / (nextAnim.in.duration + nextAnim.out.duration);
      nextAnim.in = { ...nextAnim.in, duration: Math.max(0.05, Math.round(nextAnim.in.duration * k * 100) / 100) };
      nextAnim.out = { ...nextAnim.out, duration: Math.max(0.05, Math.round(nextAnim.out.duration * k * 100) / 100) };
      animChanged = true;
      scaled.push({ key: 'prim.adaptAnimFit', params: { len: newLen.toFixed(2) } });
    }
    if (animChanged) patch.anim = nextAnim;
    // Text-clip animations (animIn/animOut { id, dur }).
    for (const kind of ['animIn', 'animOut']) {
      if (clip[kind] && typeof clip[kind].dur === 'number') {
        const d1 = scaleDur(clip[kind].dur, 0.05, newLen);
        if (d1 !== clip[kind].dur) {
          patch[kind] = { ...clip[kind], dur: d1 };
          scaled.push({ key: kind === 'animIn' ? 'prim.adaptTextIn' : 'prim.adaptTextOut', params: { from: clip[kind].dur, to: d1 } });
        }
      }
    }
    // The incoming transition scales with the clip (transitionDur still
    // clamps at use time; storing the adapted value is the visible change).
    if (clip.transition && typeof clip.transition.duration === 'number') {
      const d1 = scaleDur(clip.transition.duration, 0.2, 2);
      if (d1 !== clip.transition.duration) {
        patch.transition = { ...clip.transition, duration: d1 };
        scaled.push({ key: 'prim.adaptTransition', params: { from: clip.transition.duration, to: d1 } });
      }
    }
  }
  const beyond = keyTimes(clip).filter((t) => t > newLen + 1e-6);
  if (beyond.length) {
    unhandled.push(beyond.length === 1
      ? { key: 'prim.adaptKeysPastEndOne', params: { first: beyond[0].toFixed(2) } }
      : { key: 'prim.adaptKeysPastEnd', params: { count: beyond.length, first: beyond[0].toFixed(2) } });
  }
  if (hasCurve(clip)) unhandled.push({ key: 'prim.adaptSpeedCurve' });
  if (clip.pin) unhandled.push({ key: 'prim.adaptPinned' });
  const report = { scaled, unhandled };
  if (scaled.length || unhandled.length) patch.adaptReport = report;
  return { patch: Object.keys(patch).length ? patch : null, report };
}
// What a clip's presets would need that adaptation cannot do, without
// changing anything — for the inspector / tests. Entries are structured
// { key, params } like adaptClipPresets' report.
export function presetAdaptReport(clip, len) {
  const unhandled = [];
  const beyond = keyTimes(clip).filter((t) => t > len + 1e-6);
  if (beyond.length) {
    unhandled.push(beyond.length === 1
      ? { key: 'prim.adaptKeysPastEndSimpleOne' }
      : { key: 'prim.adaptKeysPastEndSimple', params: { count: beyond.length } });
  }
  if (hasCurve(clip)) unhandled.push({ key: 'prim.adaptSpeedCurveShort' });
  if (clip.pin) unhandled.push({ key: 'prim.adaptPinned' });
  const di = clip.anim?.in?.duration || 0;
  const dout = clip.anim?.out?.duration || 0;
  if (di + dout > len) unhandled.push({ key: 'prim.adaptAnimTooLong' });
  if (clip.transition && clip.transition.duration > len) unhandled.push({ key: 'prim.adaptTransTooLong' });
  return { scaled: [], unhandled };
}

// ---- Copy a clip's whole motion to another layer (CC-04) ----
// Keyframes alone travel through the keyframe clipboard (copyKeyframes
// above); the clip's animation (in / out / combo) has no copy path at all,
// so copyMotion/pasteMotion carry both. Paste replaces the target's anim
// with the source's (predictable: the target ends up moving exactly like
// the source) and pastes the keyframes at the playhead like pasteKeyframes.
let motionClipboard = null;
export function setMotionClipboard(data) {
  motionClipboard = data && data.version === 1 ? data : null;
  return motionClipboard;
}
export function getMotionClipboard() { return motionClipboard; }
export function copyMotion(clip) {
  const keys = copyKeyframes(clip, KEY_PROPS);
  const anim = clip.anim ? JSON.parse(JSON.stringify(clip.anim)) : null;
  if (!keys && !anim) return null;
  return setMotionClipboard({ version: 1, keys, anim });
}
export function pasteMotion(clip, data, lt) {
  if (!data || data.version !== 1) return null;
  const patch = {};
  if (data.keys) {
    const p = pasteKeyframes(clip, data.keys, lt ?? 0);
    if (p) patch.keyframes = p.keyframes;
  }
  if (data.anim) patch.anim = JSON.parse(JSON.stringify(data.anim));
  return Object.keys(patch).length ? patch : null;
}

// Previous / next keyframe time (local seconds) around the playhead, for the
// keyboard jump shortcuts. A key exactly at the playhead does not count as
// previous or next (half a frame of slack either way).
export function prevKeyTime(clip, lt, fps = 30) {
  const times = keyTimes(clip).filter((t) => t < lt - 0.5 / fps);
  return times.length ? times[times.length - 1] : null;
}
export function nextKeyTime(clip, lt, fps = 30) {
  const times = keyTimes(clip).filter((t) => t > lt + 0.5 / fps);
  return times.length ? times[0] : null;
}
// Removes the keyframes of `props` at local time lt. Returns the patch; a property left without keyframes keeps
// the value it had there.
export function removeKeys(clip, props, lt, fps = 30) {
  const b = baseAt(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  let opacity = clip.opacity;
  props.forEach((p) => {
    const k = keyAt(clip, p, lt, fps);
    if (!k) return;
    keyframes[p] = keyframes[p].filter((x) => x !== k);
    if (!keyframes[p].length) {
      delete keyframes[p];
      if (p === 'opacity') opacity = b.opacity;
      else t[p] = b[p];
    }
  });
  return { keyframes, transform: t, opacity };
}

// Patch for an edit of transform / opacity values made at local time lt (inspector, player handles): a property
// that has keyframes gets a keyframe at lt, the others change for the whole clip. values: { scale, x, y, rot,
// opacity, and any other transform field such as uniform or scaleX }.
export function editAt(clip, values, lt) {
  const st = sourceTime(clip, lt);
  const keyframes = { ...(clip.keyframes || {}) };
  const t = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  const patch = {};
  let keyed = false;
  for (const [p, v] of Object.entries(values)) {
    if (KEY_PROPS.includes(p) && hasKeys(clip, p)) {
      const isNew = !(keyframes[p] || []).some((k) => Math.abs(k.t - st) <= EPS);
      keyframes[p] = upsert(keyframes[p], st, v, isNew ? 'smooth' : undefined);
      keyed = true;
    } else if (p === 'opacity') patch.opacity = v;
    else t[p] = v;
  }
  patch.transform = t;
  if (keyed) patch.keyframes = keyframes;
  return patch;
}

// ---- Export ----
// The motion as point lists for FFmpeg, sampled at every frame and simplified (straight runs merged) within a
// tolerance far below a pixel. Each list is [[t, v], ...] in local seconds; one point means a constant.
const TOL = { s: 0.002, x: 0.0006, y: 0.0006, r: 0.1, o: 0.004 };

function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = a + 1;
    // Extend the segment while every point in between stays on the line within tol.
    while (b + 1 < pts.length) {
      const c = b + 1;
      const [ta, va] = pts[a];
      const [tc, vc] = pts[c];
      let ok = true;
      for (let i = a + 1; i < c && ok; i++) {
        const [ti, vi] = pts[i];
        if (Math.abs(va + ((vc - va) * (ti - ta)) / (tc - ta) - vi) > tol) ok = false;
      }
      if (!ok) break;
      b = c;
    }
    out.push(pts[b]);
    a = b;
  }
  return out;
}

const round = (v) => Math.round(v * 1e5) / 1e5;
export function motionCurves(clip, len, fps) {
  const n = Math.max(1, Math.ceil(len * fps));
  const raw = { s: [], x: [], y: [], r: [], o: [] };
  for (let i = 0; i <= n; i++) {
    const lt = Math.min(len, i / fps);
    const m = stateAt(clip, lt, len);
    raw.s.push([lt, m.transform.scale]);
    raw.x.push([lt, m.transform.x]);
    raw.y.push([lt, m.transform.y]);
    raw.r.push([lt, m.transform.rot]);
    raw.o.push([lt, m.opacity]);
  }
  const out = {};
  for (const k of Object.keys(raw)) {
    const pts = raw[k].map(([t, v]) => [round(t), round(v)]);
    const flat = pts.every(([, v]) => Math.abs(v - pts[0][1]) <= TOL[k] / 4);
    out[k] = flat ? [pts[0]] : simplify(pts, TOL[k]);
  }
  return out;
}

// Curves of every animated picture clip, keyed by clip id (sent with the project when exporting).
export function motionData(project) {
  const out = {};
  const fps = project.fps || 30;
  for (const c of project.videoClips) {
    if (c.gap || !hasMotion(c)) continue;
    out[c.id] = motionCurves(c, clipDuration(c), fps);
  }
  for (const c of project.overlayClips || []) {
    if (!hasMotion(c)) continue;
    out[c.id] = motionCurves(c, clipDuration(c), fps);
  }
  return out;
}
