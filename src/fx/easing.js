// Easing curves for transitions and keyframe segments: named cubic-bezier presets + custom curves.
// One solver shared by the preview, the export and the tests, so an eased motion renders identically
// everywhere. A missing ease value means linear — projects saved before easing existed render exactly
// as they did. Overshoot's control points push y past 1 on purpose (the curve settles from beyond the
// target); the solver therefore never clamps its output, only its input.

export const EASE_PRESETS = [
  { id: 'linear', name: 'Linear', pts: [0, 0, 1, 1] },
  { id: 'smooth', name: 'Smooth', pts: [0.42, 0, 0.58, 1] },
  { id: 'easeIn', name: 'Ease In', pts: [0.42, 0, 1, 1] },
  { id: 'easeOut', name: 'Ease Out', pts: [0, 0, 0.58, 1] },
  { id: 'snapIn', name: 'Snap In', pts: [0.16, 1, 0.3, 1] },
  { id: 'snapOut', name: 'Snap Out', pts: [0.7, 0, 0.84, 0] },
  { id: 'overshoot', name: 'Overshoot', pts: [0.34, 1.56, 0.64, 1] },
  // Spring and bounce are one-recoil beziers: a single cubic can turn at most twice, so each is
  // exactly one damped cycle, bounded by construction. Spring overshoots (max 1.10) then undershoots
  // (min 0.98) and settles on 1; bounce climbs, recoils (0.91 -> 0.73) and snaps to 1, never leaving
  // [0, 1]. Both are sampled shapes, verified in scripts/test-easing.mjs — not marketing names.
  { id: 'spring', name: 'Spring', pts: [0.22, 1.75, 0.48, 0.85] },
  { id: 'bounce', name: 'Bounce', pts: [0.25, 1.9, 0.55, 0.1] },
];
const BY_ID = new Map(EASE_PRESETS.map((p) => [p.id, p]));
export const easePreset = (id) => BY_ID.get(id) || null;
export const isCustomEase = (e) => !!e && typeof e === 'object'
  && ['p1x', 'p1y', 'p2x', 'p2y'].every((k) => Number.isFinite(e[k]));
export const customPts = (e) => [e.p1x, e.p1y, e.p2x, e.p2y];
export const ptsOf = (e) => {
  if (!e) return [0, 0, 1, 1];
  if (typeof e === 'string') return (BY_ID.get(e) || BY_ID.get('linear')).pts;
  if (isCustomEase(e)) return customPts(e);
  return [0, 0, 1, 1];
};
// ---- Physics easings (P3-06) ----
// True simulated motion, not bezier approximations: a damped harmonic
// oscillator (spring) and a gravity bounce. Both are analytic and
// deterministic functions of normalized time, so the preview, the export and
// the tests evaluate the same curve. They are NOT bezier presets: a cubic can
// turn at most twice, while a real spring oscillates and a real bounce has
// several impacts. Endpoints are exact by construction (see the solvers);
// the interior is the physics, unclamped — a spring overshoots past 1 and a
// bounce dips back toward 0 before it lands.
export const PHYSICS_EASES = [
  { id: 'springPhysics', name: 'Spring', physics: 'spring', defaults: { stiffness: 170, damping: 12, mass: 1 } },
  { id: 'gravityBounce', name: 'Gravity Bounce', physics: 'bounce', defaults: { gravity: 10, restitution: 0.45 } },
];
const PHYSICS_BY_ID = new Map(PHYSICS_EASES.map((p) => [p.id, p]));
export const physicsDefaults = (id) => { const p = PHYSICS_BY_ID.get(id); return p ? { ...p.defaults } : null; };
export const isPhysicsEase = (e) => {
  if (typeof e === 'string') return PHYSICS_BY_ID.has(e);
  return !!e && typeof e === 'object' && (e.physics === 'spring' || e.physics === 'bounce');
};
export const physicsIdOf = (e) => {
  if (typeof e === 'string') return PHYSICS_BY_ID.has(e) ? e : null;
  if (!e || typeof e !== 'object') return null;
  if (e.physics === 'spring') return 'springPhysics';
  if (e.physics === 'bounce') return 'gravityBounce';
  return null;
};
// Stored params merged over the defaults (unknown / non-finite values ignored).
export const physicsParamsOf = (e) => {
  const id = physicsIdOf(e);
  if (!id) return null;
  const out = { ...PHYSICS_BY_ID.get(id).defaults };
  if (e && typeof e === 'object') {
    for (const k of Object.keys(out)) {
      const v = Number(e[k]);
      if (Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
};

// Damped harmonic oscillator over normalized time: omega = sqrt(k/m) rad per
// unit, zeta = c / (2*sqrt(k*m)). Underdamped: 1 - e^(-zwt)(cos(wd t) +
// (z/sqrt(1-z^2)) sin(wd t)); over/critically damped: 1 - e^(-wt)(1+wt).
// The curve is normalized by its value at t=1 so the arrival keyframe lands
// exactly; a near-resonant undamped spring (y(1) ~ 0) gets its frequency
// nudged until it settles, so the normalisation can never explode.
export function springPhysicsValue(t, params = {}) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const { stiffness = 170, damping = 12, mass = 1 } = params;
  const k = Math.min(400, Math.max(20, stiffness));
  const c = Math.min(40, Math.max(0, damping));
  const m = Math.min(3, Math.max(0.5, mass));
  const zeta = c / (2 * Math.sqrt(k * m));
  const y = (tt, w) => {
    if (zeta < 1) {
      const wd = w * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w * tt) * (Math.cos(wd * tt) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * tt));
    }
    return 1 - Math.exp(-w * tt) * (1 + w * tt);
  };
  let w = Math.sqrt(k / m);
  let y1 = y(1, w);
  let n = 0;
  while (y1 < 0.5 && n++ < 12) { w += 0.7; y1 = y(1, w); }
  if (y1 < 0.5) return t; // unreachable with the clamped ranges; never divide by ~0
  return y(t, w) / y1;
}

// Gravity bounce over normalized time: a ball dropped from height 1, gravity
// g, rebound heights r^(2n). The whole impact sequence is time-scaled to
// settle exactly at t=1, so the shape is the physics and the endpoint is 1.
export function gravityBounceValue(t, params = {}) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const { gravity = 10, restitution = 0.45 } = params;
  const g = Math.min(40, Math.max(0.1, gravity));
  const r = Math.min(0.9, Math.max(0, restitution));
  const t1 = Math.sqrt(2 / g); // first impact
  const flights = [{ start: 0, dur: t1, h0: 1, up: false }];
  let T = t1;
  let h = r * r;
  let n = 1;
  while (h > 0.002 && n < 40) {
    const d = 2 * t1 * Math.pow(r, n);
    flights.push({ start: T, dur: d, h0: h, up: true });
    T += d;
    h *= r * r;
    n++;
  }
  const ts = t * T;
  let height = 0;
  for (const f of flights) {
    if (ts < f.start + f.dur) {
      const lt = ts - f.start;
      if (!f.up) height = f.h0 - 0.5 * g * lt * lt;
      else { const v0 = Math.sqrt(2 * g * f.h0); height = v0 * lt - 0.5 * g * lt * lt; }
      break;
    }
    height = 0;
  }
  return 1 - Math.max(0, height);
}

export function physicsValue(ease, t) {
  const id = physicsIdOf(ease);
  const p = physicsParamsOf(ease);
  if (id === 'springPhysics') return springPhysicsValue(t, p);
  if (id === 'gravityBounce') return gravityBounceValue(t, p);
  return t;
}

export const easeName = (e) => {
  if (!e || e === 'linear') return 'Linear';
  if (typeof e === 'string') {
    const phys = PHYSICS_BY_ID.get(e);
    if (phys) return phys.name;
    return (BY_ID.get(e)?.name) || e;
  }
  if (isPhysicsEase(e)) return PHYSICS_BY_ID.get(physicsIdOf(e)).name;
  if (isCustomEase(e)) return 'Custom';
  return 'Linear';
};

// Cubic bezier solver: given x (time), find y (progress). Newton iterations with a bisection fallback,
// the standard browser algorithm. Solvers are cached per control-point set.
const cache = new Map();
export function bezierSolver(x1, y1, x2, y2) {
  const key = [x1, y1, x2, y2].join(',');
  if (cache.has(key)) return cache.get(key);
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const xAt = (t) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t) => ((ay * t + by) * t + cy) * t;
  const dxAt = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = xAt(t) - x;
      if (Math.abs(err) < 1e-6) return yAt(t);
      const d = dxAt(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
      if (t < 0 || t > 1) break;
    }
    let lo = 0; let hi = 1; t = x;
    while (hi - lo > 1e-6) {
      if (xAt(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return yAt(t);
  };
  cache.set(key, solve);
  return solve;
}

// The eased progress for a stored ease value (preset id, custom object, physics ease, or nothing = linear).
export function easeValue(ease, t) {
  const x = Math.min(1, Math.max(0, t));
  if (!ease || ease === 'linear') return x;
  if (isPhysicsEase(ease)) return physicsValue(ease, x);
  const [x1, y1, x2, y2] = ptsOf(ease);
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return x;
  return bezierSolver(x1, y1, x2, y2)(x);
}
