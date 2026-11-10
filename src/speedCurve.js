// Speed ramping — the ONE timing authority for a clip's playback rate.
//
// A clip plays its source window [in, out] at the constant rate clip.speed, unless it
// carries a speed curve: clip.speedCurve = { points: [{ t, speed }] }, where t is a
// SOURCE offset in seconds from clip.in (0 .. out-in) and speed the playback rate at
// that source moment. Between points the rate varies LINEARLY in source time (the
// same model CapCut's draft schema stores as CurveSpeed speed points, arrived at
// independently here). Points are data, not a render trick: this module integrates
// the curve analytically (logarithmic segment integrals) and every consumer — the
// store's length math, the preview's playback clock and element sync, keyframe
// timing, the export graph (through the CJS mirror electron/speedcurve.cjs, kept
// byte-equivalent by scripts/test-speed-curve.mjs) — maps time through these
// functions, so preview and export cannot drift apart.
//
// A clip WITHOUT a curve takes the constant path with the exact arithmetic the app
// always used (lt * speed, span / speed), so existing projects are bit-for-bit
// unaffected. A curve whose points all sit at the clip's constant speed integrates
// to exactly the constant duration.

export const CURVE_MIN_SPEED = 0.1;
export const CURVE_MAX_SPEED = 8;
// Defensive clamp for stored data (the constant-speed dialog allows 0.05..16).
const HARD_MIN = 0.05;
const HARD_MAX = 16;

const clampSpeed = (s) => Math.min(HARD_MAX, Math.max(HARD_MIN, Number(s) || 1));

export const hasCurve = (clip) =>
  !!(clip && clip.speedCurve && Array.isArray(clip.speedCurve.points) && clip.speedCurve.points.length > 0);

export const spanOf = (clip) => Math.max(0, (clip.out || 0) - (clip.in || 0));

// Normalizes stored points for a source span: clamped to the window and to the
// editable speed range, sorted, de-duplicated (a later point wins a tie), and
// stripped of points that sit exactly on the line between their neighbours
// (repeated trims/splits must not grow the point list forever).
export function normalizePoints(points, span) {
  const byT = new Map();
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.speed)) continue;
    const t = Math.min(span, Math.max(0, p.t));
    byT.set(Math.round(t * 1000) / 1000, Math.min(CURVE_MAX_SPEED, Math.max(CURVE_MIN_SPEED, p.speed)));
  }
  const pts = [...byT.entries()].map(([t, speed]) => ({ t, speed })).sort((a, b) => a.t - b.t);
  const out = [];
  for (const p of pts) {
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const interp = a.speed + (c.speed - a.speed) * ((b.t - a.t) / Math.max(1e-9, c.t - a.t));
      if (Math.abs(interp - b.speed) > 0.002) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

// The curve as integration knots over the source window: stored points plus
// synthesized endpoints (the end speeds extend flat from the nearest point).
function knotsOf(clip) {
  const span = spanOf(clip);
  const pts = normalizePoints(clip.speedCurve.points, span);
  const knots = [];
  const first = pts[0];
  if (!first || first.t > 0) knots.push({ t: 0, speed: clampSpeed(first ? first.speed : clip.speed || 1) });
  for (const p of pts) knots.push({ t: p.t, speed: clampSpeed(p.speed) });
  const last = pts[pts.length - 1];
  if (!last || last.t < span) knots.push({ t: span, speed: clampSpeed(last ? last.speed : clip.speed || 1) });
  // Segment integrals: within a segment the rate is linear in source time, so the
  // timeline length is ds * ln(s1/s0) / (s1 - s0) (or ds / s when the rate is flat).
  let tl = 0;
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const ds = b.t - a.t;
    a.tl = tl;
    a.dur = ds <= 0 ? 0 : Math.abs(b.speed - a.speed) < 1e-9 ? ds / a.speed : (ds * Math.log(b.speed / a.speed)) / (b.speed - a.speed);
    tl += a.dur;
  }
  const tail = knots[knots.length - 1];
  if (tail) { tail.tl = tl; tail.dur = 0; }
  return { knots, span, duration: tl };
}

// Samplers are cached per clip object: clips are immutable store values (every
// edit mints a new object), so identity is a sound cache key, and the preview can
// afford a lookup per frame.
const cache = new WeakMap();
function sampler(clip) {
  let s = cache.get(clip);
  if (!s) {
    s = hasCurve(clip) ? knotsOf(clip) : null;
    cache.set(clip, s);
  }
  return s;
}

const segAt = (knots, t) => {
  let lo = 0;
  let hi = knots.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid].t <= t) lo = mid; else hi = mid;
  }
  return knots[lo];
};

// Timeline length of the clip's source window (the curve integral, or the
// constant span / speed when there is no curve).
export function clipDuration(clip) {
  const s = sampler(clip);
  if (s) return s.duration;
  return spanOf(clip) / (clip.speed || 1);
}

// Instantaneous playback rate at a SOURCE offset (seconds from clip.in).
export function speedAtSource(clip, srcOff) {
  const s = sampler(clip);
  if (!s) return clip.speed || 1;
  const t = Math.min(s.span, Math.max(0, srcOff));
  const k = segAt(s.knots, t);
  const next = s.knots[s.knots.indexOf(k) + 1];
  if (!next || next.t <= k.t) return k.speed;
  return k.speed + (next.speed - k.speed) * ((t - k.t) / (next.t - k.t));
}

// Instantaneous playback rate at a TIMELINE-local time (seconds from clip start).
export function speedAtTime(clip, lt) {
  if (!hasCurve(clip)) return clip.speed || 1;
  return speedAtSource(clip, sourceOffsetAt(clip, lt));
}

// Timeline-local time -> SOURCE offset (seconds from clip.in). The inverse map
// of timelineOffsetAt; both are exact inverses of the same segment integrals.
export function sourceOffsetAt(clip, lt) {
  const s = sampler(clip);
  if (!s) return lt * (clip.speed || 1);
  const t = Math.min(s.duration, Math.max(0, lt));
  let lo = 0;
  let hi = s.knots.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (s.knots[mid].tl <= t) lo = mid; else hi = mid;
  }
  const k = s.knots[lo];
  const next = s.knots[lo + 1];
  if (!next || k.dur <= 0) return k.t;
  const tau = t - k.tl;
  const slope = (next.speed - k.speed) / (next.t - k.t);
  if (Math.abs(slope) < 1e-12) return k.t + tau * k.speed;
  return k.t + (k.speed * (Math.exp(slope * tau) - 1)) / slope;
}

// SOURCE offset (seconds from clip.in) -> timeline-local time.
export function timelineOffsetAt(clip, srcOff) {
  const s = sampler(clip);
  if (!s) return srcOff / (clip.speed || 1);
  const t = Math.min(s.span, Math.max(0, srcOff));
  const k = segAt(s.knots, t);
  const next = s.knots[s.knots.indexOf(k) + 1];
  if (!next || next.t <= k.t) return k.tl;
  const u = t - k.t;
  const slope = (next.speed - k.speed) / (next.t - k.t);
  if (Math.abs(slope) < 1e-12) return k.tl + u / k.speed;
  return k.tl + Math.log((k.speed + slope * u) / k.speed) / slope;
}

// The curve sampled into constant-rate segments for the export graph:
// [{ srcOff, srcDur, tlDur, speed }] with exact endpoints — each segment's rate is
// its exact average (srcDur / tlDur), segments split at curve points and subdivide
// until the linear approximation of the timeline map is within tol seconds of the
// true integral everywhere inside the segment (checked at the source midpoint,
// where a linear-rate segment's error peaks). Adjacent segments of equal rate merge.
export function curveSegments(clip, tol = 1 / 240) {
  const span = spanOf(clip);
  const dur = clipDuration(clip);
  if (!hasCurve(clip)) return [{ srcOff: 0, srcDur: span, tlDur: dur, speed: clip.speed || 1 }];
  const s = sampler(clip);
  const out = [];
  const push = (srcOff, srcDur) => {
    if (srcDur <= 1e-9) return;
    const tlDur = timelineOffsetAt(clip, srcOff + srcDur) - timelineOffsetAt(clip, srcOff);
    const speed = srcDur / Math.max(1e-9, tlDur);
    const lastSeg = out[out.length - 1];
    if (lastSeg && Math.abs(lastSeg.speed - speed) / speed < 1e-9) {
      lastSeg.srcDur += srcDur;
      lastSeg.tlDur += tlDur;
    } else out.push({ srcOff, srcDur, tlDur, speed });
  };
  const subdivide = (a, b, depth) => {
    const mid = (a + b) / 2;
    const tlA = timelineOffsetAt(clip, a);
    const tlB = timelineOffsetAt(clip, b);
    const tlMid = timelineOffsetAt(clip, mid);
    const err = Math.abs(tlMid - (tlA + tlB) / 2);
    if ((err <= tol || b - a <= 0.01 || depth >= 14) && depth > 0) { push(a, b - a); return; }
    if (depth === 0 && err <= tol) { push(a, b - a); return; }
    subdivide(a, mid, depth + 1);
    subdivide(mid, b, depth + 1);
  };
  for (let i = 0; i < s.knots.length - 1; i++) {
    const a = s.knots[i];
    const b = s.knots[i + 1];
    if (b.t - a.t > 1e-9) subdivide(a.t, b.t, 0);
  }
  return out.length ? out : [{ srcOff: 0, srcDur: span, tlDur: dur, speed: clip.speed || 1 }];
}

// The sub-curve covering source offsets [from, to] of the clip's window,
// re-anchored to 0 — what a split half or a trimmed edge keeps. Edge speeds are
// sampled from the original curve so the surviving window keeps its shape.
export function sliceCurve(clip, from, to) {
  if (!hasCurve(clip)) return undefined;
  const span = Math.max(0, to - from);
  const pts = [{ t: 0, speed: speedAtSource(clip, from) }];
  for (const p of normalizePoints(clip.speedCurve.points, spanOf(clip))) {
    if (p.t > from + 1e-4 && p.t < to - 1e-4) pts.push({ t: p.t - from, speed: p.speed });
  }
  pts.push({ t: span, speed: speedAtSource(clip, to) });
  return { points: normalizePoints(pts, span) };
}

// True when every point sits at one rate (within a hair) — the curve then behaves
// exactly like that constant speed.
export function isFlatCurve(clip) {
  if (!hasCurve(clip)) return false;
  const s = sampler(clip);
  const v = s.knots[0].speed;
  return s.knots.every((k) => Math.abs(k.speed - v) < 1e-9);
}

// The constant rate that preserves the curve's duration (span / duration) —
// used when a curve is removed so the clip keeps its timeline length.
export const averageSpeed = (clip) => {
  const d = clipDuration(clip);
  return d > 0 ? spanOf(clip) / d : clip.speed || 1;
};

// Honest presets, built from multipliers of the clip's current constant rate.
// Points are (source offset, absolute rate); the editor scales them to the span.
export const SPEED_PRESETS = [
  { id: 'ramp-in', label: 'Ramp in', pts: [[0, 0.3], [1, 1]] },
  { id: 'ramp-out', label: 'Ramp out', pts: [[0, 1], [1, 0.3]] },
  { id: 'bullet', label: 'Bullet time', pts: [[0, 1.6], [0.4, 0.3], [0.6, 0.3], [1, 1.6]] },
  { id: 'pulse', label: 'Pulse', pts: [[0, 1], [0.25, 1.8], [0.5, 1], [0.75, 1.8], [1, 1]] },
];

export function presetPoints(preset, span, base) {
  return normalizePoints(
    preset.pts.map(([u, m]) => ({ t: u * span, speed: Math.min(CURVE_MAX_SPEED, Math.max(CURVE_MIN_SPEED, (base || 1) * m)) })),
    span,
  );
}
