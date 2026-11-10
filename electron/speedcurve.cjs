// Speed ramping for the EXPORT pipeline — the CJS mirror of src/speedCurve.js.
// The math is identical by construction and scripts/test-speed-curve.mjs keeps the
// two in sync over a corpus (durations, both time maps and the sampled segments
// must agree to float precision), the same arrangement as audiofx.cjs and its
// renderer mirror. clip.speedCurve = { points: [{ t, speed }] } with t a SOURCE
// offset in seconds from clip.in; between points the rate varies linearly in
// source time and segment lengths integrate analytically. A clip without a curve
// takes the constant path with the arithmetic the app has always used.

const CURVE_MIN_SPEED = 0.1;
const CURVE_MAX_SPEED = 8;
const HARD_MIN = 0.05;
const HARD_MAX = 16;

const clampSpeed = (s) => Math.min(HARD_MAX, Math.max(HARD_MIN, Number(s) || 1));

const hasCurve = (clip) =>
  !!(clip && clip.speedCurve && Array.isArray(clip.speedCurve.points) && clip.speedCurve.points.length > 0);

const spanOf = (clip) => Math.max(0, (clip.out || 0) - (clip.in || 0));

function normalizePoints(points, span) {
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

function knotsOf(clip) {
  const span = spanOf(clip);
  const pts = normalizePoints(clip.speedCurve.points, span);
  const knots = [];
  const first = pts[0];
  if (!first || first.t > 0) knots.push({ t: 0, speed: clampSpeed(first ? first.speed : clip.speed || 1) });
  for (const p of pts) knots.push({ t: p.t, speed: clampSpeed(p.speed) });
  const last = pts[pts.length - 1];
  if (!last || last.t < span) knots.push({ t: span, speed: clampSpeed(last ? last.speed : clip.speed || 1) });
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

const cache = new WeakMap();
function sampler(clip) {
  let s = cache.get(clip);
  if (s === undefined) {
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

function clipDuration(clip) {
  const s = sampler(clip);
  if (s) return s.duration;
  return spanOf(clip) / (clip.speed || 1);
}

function speedAtSource(clip, srcOff) {
  const s = sampler(clip);
  if (!s) return clip.speed || 1;
  const t = Math.min(s.span, Math.max(0, srcOff));
  const k = segAt(s.knots, t);
  const next = s.knots[s.knots.indexOf(k) + 1];
  if (!next || next.t <= k.t) return k.speed;
  return k.speed + (next.speed - k.speed) * ((t - k.t) / (next.t - k.t));
}

// Instantaneous playback rate at a TIMELINE-local time (seconds from clip start).
function speedAtTime(clip, lt) {
  if (!hasCurve(clip)) return clip.speed || 1;
  return speedAtSource(clip, sourceOffsetAt(clip, lt));
}

function sourceOffsetAt(clip, lt) {
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

function timelineOffsetAt(clip, srcOff) {
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

// Same segmentation contract as the renderer sampler (see src/speedCurve.js).
function curveSegments(clip, tol = 1 / 240) {
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

function sliceCurve(clip, from, to) {
  if (!hasCurve(clip)) return undefined;
  const span = Math.max(0, to - from);
  const pts = [{ t: 0, speed: speedAtSource(clip, from) }];
  for (const p of normalizePoints(clip.speedCurve.points, spanOf(clip))) {
    if (p.t > from + 1e-4 && p.t < to - 1e-4) pts.push({ t: p.t - from, speed: p.speed });
  }
  pts.push({ t: span, speed: speedAtSource(clip, to) });
  return { points: normalizePoints(pts, span) };
}

module.exports = {
  CURVE_MIN_SPEED, CURVE_MAX_SPEED, hasCurve, spanOf, normalizePoints,
  clipDuration, speedAtSource, speedAtTime, sourceOffsetAt, timelineOffsetAt, curveSegments, sliceCurve,
};
