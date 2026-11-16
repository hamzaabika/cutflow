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
import { FX_TRANSITIONS, PIXEL_EFFECTS, pf } from './catalog.js';
import { EASE_PRESETS } from './easing.js';
import { directionGroupFor } from './collections.js';
import { PARTICLE_SCHEMA } from './particles.js';

const TRANS_BY_ID = Object.fromEntries(FX_TRANSITIONS.map((t) => [t.id, t]));

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
  if (c) return c.params;
  // P2-1: the particle system is an overlay effect, not a pixel effect — its
  // schema lives in fx/particles.js and renders through the same ParamsControls.
  if (id === 'fx_particles') return PARTICLE_SCHEMA;
  return null;
}

// An effect's named starter presets, if it declares any: [{ id, name, params }]
// — a preset is a full parameter bundle (CC-02 film burn ships 12). The
// inspector renders them as chips (FxControls ParamsControls) that apply the
// whole bundle at once; the values themselves are ordinary schema values, so
// they round-trip through mergeFxParams / resolveFxExpr like any hand-tuned
// set. Null when the effect declares no presets.
export function fxPresets(id) {
  const e = PIXEL_BY_ID[id];
  return e && Array.isArray(e.presets) && e.presets.length ? e.presets : null;
}

// A full parameter map pruned to its sparse stored form: keys sitting at their
// default are dropped, an all-default map becomes {} — the same rule
// prunedParams applies to a single key change, for whole-bundle applies.
export function pruneFxParams(id, values) {
  const defs = fxDefaults(id);
  const next = { ...defs, ...(values || {}) };
  for (const k of Object.keys(next)) if (next[k] === defs[k]) delete next[k];
  return next;
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
// values are always inside the declared ranges. Toggle parameters
// ({ type: 'toggle', def: true/false }) merge to booleans, and option
// parameters ({ options: [...] }) validate against their list, like the
// transition side (mergeTrParams) — CC-09c halation / gate-weave toggles ride
// this so a stored true/false, 1/0 or 'true'/'false' all resolve the same way.
export function mergeFxParams(id, stored) {
  const schema = fxSchema(id);
  if (!schema) return {};
  const out = {};
  for (const p of schema) {
    const raw = stored && typeof stored === 'object' ? stored[p.key] : undefined;
    if (p.type === 'toggle') {
      out[p.key] = raw === undefined ? !!p.def : raw === true || raw === 1 || raw === 'true' || raw === '1';
      continue;
    }
    if (p.options) {
      out[p.key] = p.options.includes(raw) ? raw : p.def;
      continue;
    }
    const num = Number(raw);
    out[p.key] = Number.isFinite(num) ? Math.min(p.max, Math.max(p.min, num)) : p.def;
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

// ---- Multi-pass effects (CC-01 bloom) ----
// A multi-pass effect cannot be expressed as one pixel expression: its
// catalog entry carries multiPass: 'bloom' and make() returns the cheap
// single-pass fallback expression (thumbnails / self-test / CPU reference /
// regioned instances). The real render is a { bloom } pass object resolved
// here and executed by FxGL.bloom() in gl.js — preview and export share
// pixelPasses, so both run it. Strength (fxKeys intensity) scales the
// intensity, so keyframed fades work the same way as for expression effects.
// Color is hue + saturation at fixed lightness 0.6 (a single hex string
// cannot travel through the numeric param schema the inspector renders).
export function isMultiPassFx(id) {
  const e = PIXEL_BY_ID[id];
  return !!e?.multiPass;
}
export function hueRgb(h, s, l = 0.6) {
  const hh = ((Number(h) || 0) % 360) / 60;
  const ss = Math.min(1, Math.max(0, Number(s) || 0));
  const c = (1 - Math.abs(2 * l - 1)) * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 1000) / 1000);
}
// The numeric bloom parameters for gl.js, from stored values + strength.
export function bloomParams(id, stored, strength = 1) {
  const v = mergeFxParams(id, stored);
  return {
    threshold: v.threshold ?? 0.55,
    softness: v.softness ?? 0.35,
    radius: v.radius ?? 0.45,
    intensity: Math.max(0, (v.intensity ?? 1) * (strength ?? 1)),
    color: hueRgb(v.hue ?? 45, v.saturation ?? 0.25),
    blend: v.blend ?? 0,
    mask: v.mask ?? 0,
    quality: Math.round(v.quality ?? 1),
    pulse: v.pulse ?? 0,
    sweep: v.sweep ?? 0,
  };
}
// The pass a pixel effect renders as: { bloom } for a multi-pass effect,
// { expr } for an expression effect, null for an unknown id. The ONLY way
// the pass builder obtains a pass (see resolveFxExpr above for expressions).
export function resolveFxPass(id, stored, strength = 1) {
  const e = PIXEL_BY_ID[id];
  if (e?.multiPass === 'bloom') return { bloom: bloomParams(id, stored, strength) };
  const expr = resolveFxExpr(id, stored);
  return expr ? { expr } : null;
}

// Prune a transition's parameter map after one value changes: keys sitting at
// their default are dropped, and an all-default map disappears ({}).
export function prunedTrParams(id, current, key, value) {
  const defs = trDefaults(id);
  const next = { ...defs, ...(current || {}), [key]: value };
  for (const k of Object.keys(next)) if (next[k] === defs[k]) delete next[k];
  return next;
}

// ---- Generic transition controls (B-F05) ----
// The engine had direction/intensity only as separate variants (wipe left/right/
// up/down) or as per-transition params (clock / gradient / luma wipe, mask reveal).
// Every transition now carries the generic {duration, direction, ease, strength,
// center, softness, motionBlur} schema; keys a transition cannot use are omitted
// by family, and keys that map onto top-level transition fields (duration, ease)
// are marked `field`, so the inspector writes them there instead of into params.
// Defaults keep old projects byte-identical: strength 1, softness 0, motionBlur 0,
// direction/center at the transition's own default, duration/ease from the
// transition object itself.
//
// `live` marks whether the engine actually consumes the key for this id:
// direction switches the variant (real), center/softness drive the iris
// make() in catalog.js, feather IS the softness of the feathered wipes, and
// morph cut already has its own strength. strength/motionBlur are in the
// schema and round-trip through stored params, but have no engine hook for
// other transitions yet, so the inspector does not render dead sliders for
// them — see trSchema() below.
export const CENTER_OPTIONS = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const CENTER_POINTS = {
  center: [0.5, 0.5], 'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1],
};
export const centerPointOf = (c) => CENTER_POINTS[c] || CENTER_POINTS.center;
// Iris in/out are the only fixed-expr transitions whose make() reads a centre.
const CENTERABLE_IDS = new Set(['fx_irisout', 'fx_irisin']);
const MOTION_RE = /zoom|whip|push|slide|spin|pan|warp|shake|blur|motion|glitch|flicker|roll|fly|swing|drift/i;

// The generic entries for a transition id (before dedup against its specific
// params). `field` entries live on the transition object (tr.duration / tr.ease);
// the rest live in tr.params. A transition whose specific schema already has a
// feather uses it as its softness — no second softness key is added.
export function genericTrParams(id) {
  const t = TRANS_BY_ID[id];
  const out = [
    { key: 'duration', name: 'Duration', min: 0.1, max: 2, def: t?.duration || 0.5, step: 0.05, fmt: 'sec', field: 'duration', label: 'insp.trDuration' },
    { key: 'ease', name: 'Ease', options: EASE_PRESETS.map((p) => p.id), def: 'linear', field: 'ease', label: 'insp.trEase', optLabelKey: 'trease' },
  ];
  const g = directionGroupFor(id);
  if (g) {
    const ids = g.group.ids;
    out.push({ key: 'direction', name: 'Direction', options: Object.keys(ids), def: Object.keys(ids).find((d) => ids[d] === id) || Object.keys(ids)[0], label: 'insp.trDirection', optLabelKey: 'trdir', group: true, live: true });
  }
  if (CENTERABLE_IDS.has(id)) {
    out.push({ key: 'center', name: 'Centre', options: CENTER_OPTIONS, def: 'center', label: 'insp.trCenter', optLabelKey: 'trcenter', live: true });
  }
  out.push(
    { key: 'strength', name: 'Strength', min: 0, max: 1, def: 1, step: 0.05, fmt: 'pct', label: 'insp.trStrengthGen', live: false },
    { key: 'softness', name: 'Softness', min: 0, max: 1, def: 0, step: 0.05, fmt: 'pct', label: 'insp.trSoftness', live: CENTERABLE_IDS.has(id) },
  );
  if (MOTION_RE.test(id || '')) {
    out.push({ key: 'motionBlur', name: 'Motion blur', min: 0, max: 1, def: 0, step: 0.05, fmt: 'pct', label: 'insp.trMotionBlur', live: false });
  }
  return out;
}

// True when an effect declares at least one parameter.
export const hasFxParams = (id) => !!fxSchema(id);

// ---- Transition parameters (P2-04) ----
// Same contract as the effects above, for the parameterised transitions in
// fx/catalog.js (clock / gradient / luma wipe, mask reveal). The schema for a
// transition id, or null when it has no parameters; { key: default } pairs;
// stored values merged over the defaults, clamped to the schema ranges, option
// values validated against their list. transitionExpr is the ONLY way the
// preview, the export fx pass, the thumbnails and the self-test obtain a
// transition's expression, so a feather / direction behaves identically in
// every path. Unknown ids resolve to null.
// Per-transition audio fade (FB-13, P1-10): clip.transition.audioFade =
// { mode: 'auto' | 'custom' | 'off', duration }. Absent IS auto, so a
// project saved before audio fades existed renders exactly as it always
// did. Mirror of normalizeAudioFade in electron/ffmpeg.cjs — the two must
// agree on what counts as a mode.
export function normalizeAudioFade(af) {
  if (!af || typeof af !== 'object') return { mode: 'auto', duration: 0.5 };
  const mode = ['auto', 'custom', 'off'].includes(af.mode) ? af.mode : 'auto';
  const duration = Math.max(0, Number(af.duration) || 0);
  return { mode, duration: mode === 'custom' ? Math.max(0.1, duration || 0.5) : duration };
}
// The patch a single inspector change applies to a transition object: a
// generic direction change switches the TYPE to the sibling variant (wipe
// left -> wipe right), re-pruning params against the new type; a field key
// (duration/ease) writes the top-level field; anything else prunes into params.
export function trParamsPatch(tr, key, value) {
  if (key === 'direction') {
    const g = directionGroupFor(tr.type);
    if (g && g.group.ids[value] && g.group.ids[value] !== tr.type) {
      const next = { ...tr, type: g.group.ids[value] };
      const merged = mergeTrParams(next.type, tr.params);
      const defs = trDefaults(next.type);
      const params = {};
      for (const k of Object.keys(merged)) if (merged[k] !== defs[k]) params[k] = merged[k];
      return { ...next, params: Object.keys(params).length ? params : undefined };
    }
    // No direction group for this type: direction is one of its own
    // params (fx_clockwipe cw/ccw, fx_cardflip horizontal/vertical,
    // fx_gradientwipe, fx_maskreveal) — fall through to the param prune
    // below instead of dropping the change. Before this, the direction
    // buttons rendered but clicked to nothing for those transitions.
  }
  if (key === 'duration' || key === 'ease') return { ...tr, [key]: value };
  const next = prunedTrParams(tr.type, tr.params, key, value);
  return { ...tr, params: Object.keys(next).length ? next : undefined };
}

export function trSchema(id) {
  const t = TRANS_BY_ID[id];
  const specific = (t ? t.params || [] : []).map((p) => ({ ...p, live: true }));
  const keys = new Set(specific.map((p) => p.key));
  // Generic entries join the specific schema: field entries (duration/ease)
  // stay off the params schema — they live on the transition object and both
  // inspector panels already render their own controls for them. A generic
  // softness is skipped where the transition already has a feather (the
  // feather slider IS its softness); a generic center is skipped where the
  // specific schema already positions the reveal (mask reveal).
  const generic = genericTrParams(id).filter((p) => {
    if (p.field) return false;
    if (keys.has(p.key)) return false;
    // A generic softness is skipped where the transition already has a
    // feather (the feather slider IS its softness) — except the iris,
    // where feather (slope stretch) and softness (band width) are two
    // different controls and the make() reads both.
    if (p.key === 'softness' && keys.has('feather') && !CENTERABLE_IDS.has(id)) return false;
    if (p.key === 'center' && (keys.has('center') || keys.has('shape'))) return false;
    return true;
  });
  return specific.length || generic.length ? [...specific, ...generic] : null;
}
export function trDefaults(id) {
  const schema = trSchema(id);
  if (!schema) return {};
  return Object.fromEntries(schema.map((p) => [p.key, p.def]));
}
export function mergeTrParams(id, stored) {
  const schema = trSchema(id);
  if (!schema) return {};
  const out = {};
  for (const p of schema) {
    if (p.options) {
      const raw = stored && typeof stored === 'object' ? stored[p.key] : undefined;
      out[p.key] = p.options.includes(raw) ? raw : p.def;
    } else {
      const raw = stored && typeof stored === 'object' ? Number(stored[p.key]) : NaN;
      out[p.key] = Number.isFinite(raw) ? Math.min(p.max, Math.max(p.min, raw)) : p.def;
    }
  }
  return out;
}
export function transitionExpr(tr) {
  if (!tr || typeof tr !== 'object') return null;
  const def = TRANS_BY_ID[tr.type];
  if (!def) return null;
  // Morph cut (P3-03): this is the FALLBACK expression (dissolve) the
  // renderers use when the flow analysis says the shots cannot morph. The
  // real warp never goes through here — see morph.js renderMorphFrame.
  if (typeof def.make === 'function') return def.make(mergeTrParams(tr.type, tr.params));
  return def.expr;
}
export const hasTrParams = (id) => !!trSchema(id);

// ---- Generic transition parameters (FB-11 · P1-08) ----
// The generic schema every transition COULD expose, gated per transition by
// trCapabilities: a control is offered ONLY where it is really wired, so no
// irrelevant control is ever forced on a transition where it doesn't apply.
//   duration — every transition (the transition's own duration; the engine
//     clamps it to half of either neighbour — see fx/transitionBounds.js).
//   ease — fx transitions only (tr.ease, edited in the motion-curve card).
//   direction — the schema's direction option where one exists, or the
//     direction-group engine swap (wipeleft ↔ wiperight …) for the classic
//     directionals (rendered by TransitionInspector from collections.js).
//   softness — the schema's feather key, shown under its inspector name.
//   strength — the schema's strength key (today only fx_morphcut's warp,
//     keyframe-aware via tr.strengthKeys — see morph.js transitionStrengthAt).
//   center — fx_maskreveal's direction option 'center'/'edges': it IS the
//     direction, so no separate center control is rendered.
//   motionBlur — DECLARED but NOT WIRED: no engine transition takes a
//     motion-blur amount, so trCapabilities never returns it and the
//     inspector never shows it. It stays here as the named slot for a future
//     wired implementation; the test enforces the never-exposed rule.
export const GENERIC_TR_SCHEMA = [
  { key: 'duration', name: 'Duration', min: 0.2, max: 2, def: 0.5, step: 0.05, fmt: 's' },
  { key: 'direction', name: 'Direction', options: ['from-left', 'from-right', 'from-top', 'from-bottom', 'diagonal', 'diagonal-2', 'left', 'right', 'up', 'down', 'center', 'edges'], def: 'from-left' },
  { key: 'ease', name: 'Ease', options: ['linear', 'smooth', 'easeIn', 'easeOut'], def: 'linear' },
  { key: 'strength', name: 'Strength', min: 0, max: 1, def: 1, step: 0.05, fmt: 'pct' },
  { key: 'center', name: 'Center', options: ['center', 'edges'], def: 'center' },
  { key: 'softness', name: 'Softness', min: 0, max: 0.3, def: 0.08, step: 0.01, fmt: 'pct' },
  { key: 'motionBlur', name: 'Motion blur', min: 0, max: 1, def: 0, step: 0.05, fmt: 'pct' },
];

// The wired controls for a transition id: [{ key, source, ... }]. `source`
// tells the inspector how the value is stored: 'duration' (tr.duration),
// 'ease' (tr.ease, motion-curve card), 'schema' (tr.params[schemaKey]).
// motionBlur is never returned — it has no wiring anywhere.
export function trCapabilities(id) {
  const caps = [{ key: 'duration', source: 'duration' }];
  const schema = trSchema(id);
  if (schema) {
    for (const p of schema) {
      // Generic (live:false) entries are declared slots, not wired controls:
      // the generic strength/softness/motionBlur sliders read no engine
      // parameter (dissolve renders identically at strength 0.5 and 1.0),
      // so offering them would put a dead slider in the inspector. Only
      // live entries (specific params, direction-group, centerable softness)
      // become controls.
      if (p.live === false) continue;
      if (p.key === 'direction') caps.push({ key: 'direction', source: 'schema', schemaKey: 'direction', options: p.options, def: p.def });
      else if (p.key === 'feather') caps.push({ key: 'softness', source: 'schema', schemaKey: 'feather', min: p.min, max: p.max, step: p.step, def: p.def });
      else if (p.key === 'strength') caps.push({ key: 'strength', source: 'schema', schemaKey: 'strength', min: p.min, max: p.max, step: p.step, def: p.def });
    }
  }
  if (TRANS_BY_ID[id]) caps.push({ key: 'ease', source: 'ease' });
  return caps;
}

// Defaults for the wired generic keys of a transition (duration/ease aside,
// which live on tr itself).
export function trGenericDefaults(id) {
  const out = {};
  for (const c of trCapabilities(id)) if (c.source === 'schema') out[c.key] = c.def;
  return out;
}


