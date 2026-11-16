// Effect intensity keyframes (P2-20): an effect instance's strength (0..1)
// as a function of clip-local time, instead of one static value for the
// whole clip. Keys live on the instance: clip.fxKeys[fxId] for clip-bound
// effects, effectClip.keys for free Effects-track objects — a list of
// { t, v } sorted by t, t in clip-local seconds. Between keys the strength
// interpolates linearly; before the first key it holds the first value,
// after the last it holds the last. A clip with no keys renders exactly as
// before (static fxStrength / strength), so old projects are untouched.
// Both the preview and the export read the strength through fxStrengthAt
// (src/fx/apply.js), so keyframed intensity has preview/export parity by
// construction.

const clamp01 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
};

// Normalize a stored key list: finite {t, v} pairs, sorted, de-duplicated
// by time (last wins), t clamped to [0, span]. Returns [] when nothing
// usable survives.
export function sanitizeFxKeys(keys, span = Infinity) {
  if (!Array.isArray(keys)) return [];
  const byT = new Map();
  for (const k of keys) {
    if (!k || typeof k !== 'object') continue;
    const t = Number(k.t);
    const v = Number(k.v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    byT.set(Math.min(Math.max(0, t), Number.isFinite(span) ? span : t), clamp01(v));
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

// The strength at clip-local time t: interpolated between the surrounding
// keys, held outside them. With no keys, the static fallback (the
// instance's fxStrength / strength, absent = 1).
export function fxStrengthAt(keys, t, fallback = 1) {
  const ks = sanitizeFxKeys(keys);
  if (!ks.length) return fallback == null ? 1 : clamp01(fallback);
  if (t <= ks[0].t) return ks[0].v;
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1].v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * p;
    }
  }
  return ks[ks.length - 1].v;
}

// Set (or replace) the key at time t; returns the new sorted list.
export function upsertFxKey(keys, t, v, span = Infinity) {
  const ks = sanitizeFxKeys(keys, span).filter((k) => Math.abs(k.t - t) > 1e-6);
  ks.push({ t: Math.min(Math.max(0, Number(t) || 0), Number.isFinite(span) ? span : Number(t) || 0), v: clamp01(v) });
  return ks.sort((a, b) => a.t - b.t);
}

// Remove the key nearest time t (within 0.05 s); returns the new list.
export function removeFxKey(keys, t) {
  const ks = sanitizeFxKeys(keys);
  if (!ks.length) return ks;
  let best = 0;
  let bestD = Infinity;
  ks.forEach((k, i) => {
    const d = Math.abs(k.t - t);
    if (d < bestD) { bestD = d; best = i; }
  });
  if (bestD > 0.05) return ks;
  return ks.filter((_, i) => i !== best);
}
