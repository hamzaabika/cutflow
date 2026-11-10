// Volume keyframes for the EXPORT pipeline — the CJS mirror of
// src/volKeys.js. The math is identical by construction and
// scripts/test-volkeys.mjs keeps the two in sync (normalization, traces and
// sampled point lists must agree to float precision), the same arrangement
// as speedcurve.cjs and its renderer twin. See src/volKeys.js for the model:
// clip.volKeys = [{ t, v }] with t an absolute SOURCE time; the gain stack
// is mute -> keyframe curve (or clip.volume) -> fade envelope, applied after
// the clip's sound source (media / enhance / AudioFx derivative) in both
// preview and export.

const sc = require('./speedcurve.cjs');

const VOL_MIN = 0;
const VOL_MAX = 2;
const VOL_SAMPLE_FPS = 30;
const VOL_SIMPLIFY_TOL = 0.008;

const clampGain = (v) => Math.min(VOL_MAX, Math.max(VOL_MIN, Number.isFinite(Number(v)) ? Number(v) : 1));

function normalizeVolKeys(clip) {
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

const hasVolKeys = (clip) => !!clip && Array.isArray(clip.volKeys) && clip.volKeys.length > 0;

function keyedVolumeAt(clip, lt) {
  if (!hasVolKeys(clip)) return null;
  const pts = normalizeVolKeys(clip);
  if (!pts.length) return null;
  const st = (clip.in || 0) + sc.sourceOffsetAt(clip, Math.max(0, lt));
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

function volumeAt(clip, lt) {
  const k = keyedVolumeAt(clip, lt);
  return k !== null ? k : (clip && Number.isFinite(clip.volume) ? clip.volume : 1);
}

function fadeEnv(clip, lt, len) {
  let g = 1;
  const fi = Math.min(Math.max(0, (clip && clip.fadeIn) || 0), len);
  const fo = Math.min(Math.max(0, (clip && clip.fadeOut) || 0), len);
  if (fi > 0 && lt < fi) g *= Math.max(0, lt / fi);
  if (fo > 0 && lt > len - fo) g *= Math.max(0, (len - lt) / fo);
  return g;
}

function clipGainAt(clip, lt, len = sc.clipDuration(clip)) {
  if (!clip || len <= 0) return 0;
  const t = Math.min(len, Math.max(0, lt));
  return volumeAt(clip, t) * fadeEnv(clip, t, len);
}

function volKeyLocalPoints(clip) {
  return normalizeVolKeys(clip).map((p) => ({
    t: p.t,
    lt: sc.timelineOffsetAt(clip, p.t - (clip.in || 0)),
    v: p.v,
  }));
}

function simplifyPoints(pts, tol) {
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

function volCurvePoints(clip, len) {
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

// The `volume` filter for a clip's tail: a plain constant when the gain
// never moves (bit-for-bit the historical form), otherwise a piecewise-
// linear expression over the filter's frame timestamp t (clip-local
// timeline seconds — every chain that consumes this runs it after the
// trim/atempo stage, where timestamps start at 0 at the clip's start).
const f4 = (n) => String(Math.round(n * 10000) / 10000);
function volExprFor(clip, len) {
  const pts = volCurvePoints(clip, len);
  const v0 = pts.length ? pts[0][1] : 1;
  if (!pts.length || pts.every((p) => Math.abs(p[1] - v0) < 1e-9)) return `volume=${f4(v0)}`;
  let expr = f4(pts[pts.length - 1][1]);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [t0, g0] = pts[i];
    const [t1, g1] = pts[i + 1];
    const seg = `${f4(g0)}+(${f4(g1)}-${f4(g0)})*(t-${f4(t0)})/${f4(Math.max(1e-4, t1 - t0))}`;
    expr = `if(lt(t,${f4(t1)}),${seg},${expr})`;
  }
  return `volume='${expr}':eval=frame`;
}

// The gain filters for an export chain, as an array: a keyframed (evaluated)
// volume is preceded by a frame splitter, because eval=frame samples the
// expression once per input frame and decoder frames run ~85 ms — without
// the split, steep ramps render as a coarse staircase and the corners of a
// dip land measurably off the preview trace (the parity suite caught a
// 1.23 ratio spread; 1024-sample frames bring it inside tolerance).
function volChainFor(clip, len) {
  const expr = volExprFor(clip, len);
  return expr.includes('eval=frame') ? ['asetnsamples=n=1024:p=1', expr] : [expr];
}

module.exports = {
  VOL_MIN, VOL_MAX, VOL_SAMPLE_FPS, VOL_SIMPLIFY_TOL,
  normalizeVolKeys, hasVolKeys, keyedVolumeAt, volumeAt, fadeEnv, clipGainAt,
  volKeyLocalPoints, volCurvePoints, volExprFor, volChainFor,
};
