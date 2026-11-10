// Volume keyframes — the ONE gain automation authority for a clip's sound.
//
// A clip may carry clip.volKeys = [{ t, v }]: t is an absolute SOURCE time in
// seconds (media time, the same convention the picture keyframes in anim.js
// use, so splits and trims keep the points glued to the sound they were set
// on — both halves of a split carry the list and evaluate it unchanged), and
// v is the clip gain at that moment, 0..2. Between points the gain varies
// LINEARLY in source time; outside the point range the nearest point's gain
// holds flat.
//
// Gain stack order — defined ONCE, here, and honoured by every consumer:
//   mute (store renderable / preview / export gates)
//   -> volume keyframe curve when the clip has keys, else clip.volume
//   -> fade envelope (clip.fadeIn / clip.fadeOut, linear ramps — the same
//      shape FFmpeg's afade uses with its default curve)
// The AudioFx chain / voice-enhance derivative is the clip's SOUND SOURCE and
// sits below all of this: gains apply after it in preview and export alike,
// so riding the volume never invalidates a derivative render.
//
// The preview evaluates clipGainAt per frame (Preview.jsx); the export
// samples the same functions into a `volume=...:eval=frame` expression
// through the CJS mirror electron/volkeys.cjs. scripts/test-volkeys.mjs
// keeps the two in sync and measures the rendered export against this trace.

import { clipDuration, sourceOffsetAt, timelineOffsetAt } from './speedCurve.js';

export const VOL_MIN = 0;
export const VOL_MAX = 2;
// Sampling density for the export expression. 30 samples/s, simplified to a
// gain tolerance, keeps expressions small while corners stay exact (every
// key's local time is sampled explicitly, so simplification never rounds a
// corner off).
export const VOL_SAMPLE_FPS = 30;
export const VOL_SIMPLIFY_TOL = 0.008;

const clampGain = (v) => Math.min(VOL_MAX, Math.max(VOL_MIN, Number.isFinite(Number(v)) ? Number(v) : 1));

// Stored points for a clip, normalized: inside the clip's source window,
// sorted, de-duplicated (a later point wins a tie), gains clamped, and points
// sitting on the line between their neighbours (within the simplify
// tolerance) dropped so repeated edits cannot grow the list forever.
export function normalizeVolKeys(clip) {
  // Times are NOT clamped to the clip's [in, out] window: a key outside the
  // window is the interpolation anchor for the slope inside it. Clamping
  // would merge distinct keys at the boundary and flatten the curve the
  // moment a clip is split or trimmed (the split suite pins this).
  const byT = new Map();
  for (const p of (clip && clip.volKeys) || []) {
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
    byT.set(Math.round(p.t * 1000) / 1000, clampGain(p.v));
  }
  const pts = [...byT.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of pts) {
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const interp = a.v + (c.v - a.v) * ((b.t - a.t) / Math.max(1e-9, c.t - a.t));
      if (Math.abs(interp - b.v) > VOL_SIMPLIFY_TOL) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

export const hasVolKeys = (clip) => !!clip && Array.isArray(clip.volKeys) && clip.volKeys.length > 0;

// The keyframed gain at a TIMELINE-local time lt (seconds from the clip's
// timeline start), or null when the clip carries no keys — callers then fall
// back to clip.volume. Source time runs through the speed sampler, so keys
// stay glued under constant speed and speed curves alike.
export function keyedVolumeAt(clip, lt) {
  if (!hasVolKeys(clip)) return null;
  const pts = normalizeVolKeys(clip);
  if (!pts.length) return null;
  const st = (clip.in || 0) + sourceOffsetAt(clip, Math.max(0, lt));
  if (st <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (st >= last.t) return last.v;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (st >= a.t && st <= b.t) {
      if (b.t - a.t < 1e-9) return b.v;
      return a.v + (b.v - a.v) * ((st - a.t) / (b.t - a.t));
    }
  }
  return last.v;
}

// Gain before fades: the keyframe curve when present, else clip.volume.
export function volumeAt(clip, lt) {
  const k = keyedVolumeAt(clip, lt);
  return k !== null ? k : (clip && Number.isFinite(clip.volume) ? clip.volume : 1);
}

// The fade envelope at a timeline-local time (1 outside the fades). Linear
// ramps, exactly the preview's long-standing audio-clip math and FFmpeg
// afade's default (tri) curve, so preview and export draw the same shape.
export function fadeEnv(clip, lt, len) {
  let g = 1;
  const fi = Math.min(Math.max(0, (clip && clip.fadeIn) || 0), len);
  const fo = Math.min(Math.max(0, (clip && clip.fadeOut) || 0), len);
  if (fi > 0 && lt < fi) g *= Math.max(0, lt / fi);
  if (fo > 0 && lt > len - fo) g *= Math.max(0, (len - lt) / fo);
  return g;
}

// THE gain of a clip's sound at a timeline-local time: curve-or-volume times
// the fade envelope. Preview calls this per frame; the parity suite compares
// the export's rendered envelope against it.
export function clipGainAt(clip, lt, len = clipDuration(clip)) {
  if (!clip || len <= 0) return 0;
  const t = Math.min(len, Math.max(0, lt));
  return volumeAt(clip, t) * fadeEnv(clip, t, len);
}

// The key points in timeline-local coordinates (for drawing and editing on
// the timeline): [{ t (source), lt, v }].
export function volKeyLocalPoints(clip) {
  return normalizeVolKeys(clip).map((p) => ({
    t: p.t,
    lt: timelineOffsetAt(clip, p.t - (clip.in || 0)),
    v: p.v,
  }));
}

// Set (or move) the key at timeline-local time lt to gain v; returns the new
// volKeys array (normalized). A key within 30 ms of an existing one replaces
// it — the editor's "one point per moment" rule.
export function upsertVolKey(clip, lt, v) {
  const st = (clip.in || 0) + sourceOffsetAt(clip, Math.max(0, lt));
  const rest = normalizeVolKeys(clip).filter((p) => Math.abs(p.t - st) > 0.03);
  return normalizeVolKeys({ ...clip, volKeys: [...rest, { t: st, v: clampGain(v) }] });
}

// Remove the key nearest source time t (within eps seconds); returns the new
// volKeys array, or null when nothing was near.
export function removeVolKey(clip, t, eps = 0.05) {
  const pts = normalizeVolKeys(clip);
  const i = pts.findIndex((p) => Math.abs(p.t - t) <= eps);
  if (i < 0) return null;
  return normalizeVolKeys({ ...clip, volKeys: pts.filter((_, k) => k !== i) });
}

// The keyframed gain curve (WITHOUT fades — fades ride separately as afade
// in the export graph, exactly as they multiply separately in clipGainAt)
// sampled into [lt, gain] points for the export expression: a uniform grid
// at VOL_SAMPLE_FPS plus every key's exact local time, simplified to
// VOL_SIMPLIFY_TOL. The CJS mirror produces byte-identical point lists.
export function volCurvePoints(clip, len) {
  const L = Math.max(0, len);
  if (!hasVolKeys(clip) || L <= 0) {
    const v = clip && Number.isFinite(clip.volume) ? clip.volume : 1;
    return [[0, v], [L, v]];
  }
  const times = new Set([0, L]);
  const n = Math.max(1, Math.round(L * VOL_SAMPLE_FPS));
  for (let i = 0; i <= n; i++) times.add((L * i) / n);
  for (const p of volKeyLocalPoints(clip)) {
    if (p.lt > 0 && p.lt < L) times.add(Math.round(p.lt * 10000) / 10000);
  }
  const raw = [...times].sort((a, b) => a - b).map((t) => [t, volumeAt(clip, t)]);
  return simplifyPoints(raw, VOL_SIMPLIFY_TOL);
}

// Recursive midpoint simplification (the anim.js motionCurves pattern): a
// segment survives unsplit when its midpoint sits within tol of the chord.
export function simplifyPoints(pts, tol) {
  if (pts.length <= 2) return pts.map((p) => [...p]);
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const walk = (a, b) => {
    if (b - a < 2) return;
    const [t0, v0] = pts[a];
    const [t1, v1] = pts[b];
    let worst = -1;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const f = t1 - t0 < 1e-9 ? 0 : (pts[i][0] - t0) / (t1 - t0);
      const d = Math.abs(pts[i][1] - (v0 + (v1 - v0) * f));
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol && wi > 0) {
      keep[wi] = true;
      walk(a, wi);
      walk(wi, b);
    }
  };
  walk(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]).map((p) => [...p]);
}
