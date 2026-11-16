// Per-effect parameter schema (parity-matrix §5) — the single source of truth for
// "what can be tuned on this effect, and what expression does that produce".
//
// Every shader effect (the pixel library in fx/catalog.js and the six classic
// effects) may declare typed parameters: { key, name, min, max, def, step, fmt? }.
// The inspector renders those definitions (fx/components/FxControls.jsx) — there is
// no hand-built per-effect UI left. Values live on the effect instance:
// clip.fxParams[fxId] for clip-bound effects, effectClip.params for free
// Effects-track objects. Only non-default values are stored; an absent value IS
// the default, so a project saved before parameters existed — or with a parameter
// never touched — resolves to exactly the expression it always rendered with.
// resolveFxExpr is the ONLY way the pass builder obtains an effect's expression,
// for preview and export alike (both run pixelPasses in fx/apply.js).
import { PIXEL_EFFECTS, pf } from './catalog.js';

const PIXEL_BY_ID = Object.fromEntries(PIXEL_EFFECTS.map((e) => [e.id, e]));

// The classic effects' parameterised builders. Their default-value expressions are
// byte-identical to the shader forms that have defined the classics since the
// Sprint 6 unification (they lived in fx/apply.js as TRACK_CLASSIC; the strings
// moved here unchanged so the schema registry can own every effect's parameters).
export const CLASSIC_PARAMS = {
  blur: {
    params: [{ key: 'radius', name: 'Radius', min: 0.002, max: 0.04, def: 0.012, step: 0.001, fmt: 'pct' }],
    make: (v) => `st(0, H*${pf(v.radius)}); (S(X, Y)*2 + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0)) + S(X+ld(0), Y+ld(0)) + S(X-ld(0), Y-ld(0)) + S(X+ld(0), Y-ld(0)) + S(X-ld(0), Y+ld(0)))/10`,
  },
  grain: {
    params: [{ key: 'amount', name: 'Grain', min: 0, max: 80, def: 36, step: 1 }],
    make: (v) => `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*${pf(v.amount)}`,
  },
  pixel: {
    params: [{ key: 'cells', name: 'Cells across', min: 4, max: 96, def: 24, step: 1 }],
    make: (v) => `st(0, max(2, W/${Math.round(v.cells)})); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`,
  },
  vignette: {
    params: [{ key: 'amount', name: 'Darkening', min: 0, max: 1, def: 0.6, step: 0.01, fmt: 'pct' }],
    make: (v) => `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); S(X, Y) * (1 - ${pf(v.amount)}*smooth(0.4, 1.0, ld(0)))`,
  },
};
// Classics without parameters keep a fixed expression.
export const CLASSIC_STATIC = {
  mirror: `S(W - 1 - X, Y)`,
  flipv: `S(X, H - 1 - Y)`,
};
export const CLASSIC_IDS = [...Object.keys(CLASSIC_PARAMS), ...Object.keys(CLASSIC_STATIC)];

// The schema for an effect id, or null when the effect has no parameters.
export function fxSchema(id) {
  const e = PIXEL_BY_ID[id];
  if (e) return e.params || null;
  const c = CLASSIC_PARAMS[id];
  return c ? c.params : null;
}

// { key: defaultValue } for an effect, or {} when it has no parameters.
export function fxDefaults(id) {
  const schema = fxSchema(id);
  if (!schema) return {};
  return Object.fromEntries(schema.map((p) => [p.key, p.def]));
}

// Stored values merged over the defaults, clamped to the schema ranges. Unknown
// keys are dropped; non-numeric values fall back to the default. This is what
// makes hand-edited or older projects safe: whatever is stored, the resolved
// values are always inside the declared ranges.
export function mergeFxParams(id, stored) {
  const schema = fxSchema(id);
  if (!schema) return {};
  const out = {};
  for (const p of schema) {
    const raw = stored && typeof stored === 'object' ? Number(stored[p.key]) : NaN;
    out[p.key] = Number.isFinite(raw) ? Math.min(p.max, Math.max(p.min, raw)) : p.def;
  }
  return out;
}

// The expression an effect instance renders with, given its stored parameter
// values (undefined = all defaults = the expression the effect has always had).
// Returns null for unknown ids.
export function resolveFxExpr(id, stored) {
  const e = PIXEL_BY_ID[id];
  if (e) return e.make ? e.make(mergeFxParams(id, stored)) : e.expr;
  const c = CLASSIC_PARAMS[id];
  if (c) return c.make(mergeFxParams(id, stored));
  if (CLASSIC_STATIC[id]) return CLASSIC_STATIC[id];
  return null;
}

// True when an effect declares at least one parameter.
export const hasFxParams = (id) => !!fxSchema(id);
