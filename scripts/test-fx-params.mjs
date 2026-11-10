// Per-effect parameter schema (parity-matrix §5) + the stale-fxStrength prune
// (Sprint 12). Pins:
//  1. Losslessness — every parameterised effect's default resolution is
//     byte-identical to the expression it rendered with before the schema
//     existed (goldens below are those pre-schema strings, verbatim).
//  2. The schema drives rendering — changing a parameter changes the pixels,
//     through the ONE pass builder (pixelPasses) that preview and export share.
//  3. Stored values round-trip through the store + JSON + normalizeProject
//     unchanged, and out-of-range values resolve clamped to the schema.
//  4. removeEffect prunes ALL FOUR instance maps (fxRegions, fxTiming,
//     fxStrength, fxParams): remove → re-add starts from defaults, no ghost.
// Usage: node scripts/test-fx-params.mjs
import assert from 'node:assert/strict';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { fxSchema, fxDefaults, mergeFxParams, resolveFxExpr } from '../src/fx/params.js';
import { pixelPasses } from '../src/fx/apply.js';
import { runEffect } from '../src/fx/run.js';
import { historyReducer, normalizeProject } from '../src/store.js';

// ---- Goldens: the pre-schema expressions, verbatim -------------------------
const GOLDEN_CLASSIC = {
  blur: `st(0, H*0.012); (S(X, Y)*2 + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0)) + S(X+ld(0), Y+ld(0)) + S(X-ld(0), Y-ld(0)) + S(X+ld(0), Y-ld(0)) + S(X-ld(0), Y+ld(0)))/10`,
  grain: `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*36`,
  pixel: `st(0, max(2, W/24)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`,
  vignette: `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); S(X, Y) * (1 - 0.6*smooth(0.4, 1.0, ld(0)))`,
  mirror: `S(W - 1 - X, Y)`,
  flipv: `S(X, H - 1 - Y)`,
};
for (const [id, expr] of Object.entries(GOLDEN_CLASSIC)) {
  assert.equal(resolveFxExpr(id), expr, `classic ${id}: default resolution is the pre-schema expression`);
  assert.equal(resolveFxExpr(id, fxDefaults(id)), expr, `classic ${id}: explicit defaults resolve identically`);
}
const GOLDEN_PIXEL = {
  fx_rgb2: `S(X + C(W*0.003, 0, -W*0.003), Y)`,
  fx_rgb6: `S(X + C(W*0.009, 0, -W*0.009) + (hash(floor(T*24)+0.5)-0.5)*W*0.002, Y)`,
  fx_mosaic60: `st(0, max(2, W/90)); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`,
  fx_poster4: `floor(S(X, Y)/64)*64 + 32`,
  fx_poster6: `floor(S(X, Y)/43)*43 + 21`,
  fx_solar: `if(gt(S(X, Y), 130), 255 - S(X, Y), S(X, Y))`,
  fx_bitcut: `floor(S(X, Y)/32)*32*(0.82 + 0.18*fract(Y/2))`,
  fx_scanline: `S(X, Y) * (1 - 0.38*fract(floor(Y/max(1, H/220))/2)*2)`,
  fx_halftone: `st(0, max(2, W/110)); st(1, hypot(fract(X/ld(0)) - 0.5, fract(Y/ld(0)) - 0.5)); S(X, Y) * (0.3 + 0.7*clip(0.72 - ld(1) + L(X, Y)/255*0.45, 0, 1))`,
  fx_grainfine: `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*16`,
};
for (const [id, expr] of Object.entries(GOLDEN_PIXEL)) {
  assert.equal(resolveFxExpr(id), expr, `${id}: default resolution is the pre-schema expression`);
}

// ---- Schema sanity + structural losslessness for every parameterised effect -
const parameterised = PIXEL_EFFECTS.filter((e) => e.params);
assert.ok(parameterised.length >= 24, `pixel library carries ${parameterised.length} parameterised effects (expected >= 24)`);
for (const e of PIXEL_EFFECTS) {
  if (!e.params) continue;
  for (const p of e.params) {
    assert.ok(p.min < p.max && p.def >= p.min && p.def <= p.max && p.step > 0, `${e.id}.${p.key}: schema ranges are sane`);
  }
  assert.equal(resolveFxExpr(e.id), e.expr, `${e.id}: resolveFxExpr(defaults) === catalog expr`);
  assert.equal(resolveFxExpr(e.id, fxDefaults(e.id)), e.expr, `${e.id}: explicit defaults === catalog expr`);
}
for (const id of ['blur', 'grain', 'pixel', 'vignette']) assert.ok(fxSchema(id)?.length >= 1, `classic ${id} declares its schema`);
assert.equal(fxSchema('mirror'), null, 'mirror has no parameters (geometric)');
assert.equal(fxSchema('fx_invert'), null, 'unparameterised effects report no schema');
assert.equal(resolveFxExpr('fx_invert'), PIXEL_EFFECTS.find((e) => e.id === 'fx_invert').expr, 'unparameterised effects resolve to their stored expr');
assert.equal(resolveFxExpr('nope'), null, 'unknown ids resolve to null');

// ---- Clamping / sanitising of stored values --------------------------------
assert.equal(mergeFxParams('fx_mosaic60', { cells: 99999 }).cells, 240, 'values clamp to the schema max');
assert.equal(mergeFxParams('fx_mosaic60', { cells: -5 }).cells, 8, 'values clamp to the schema min');
assert.equal(mergeFxParams('fx_mosaic60', { cells: 'wide' }).cells, 90, 'non-numeric values fall back to the default');
assert.deepEqual(mergeFxParams('fx_mosaic60', { cells: 40, bogus: 1 }), { cells: 40 }, 'unknown keys are dropped');
assert.deepEqual(mergeFxParams('fx_mosaic60', undefined), { cells: 90 }, 'absent values are the defaults');

// ---- A parameter change changes the rendered pixels -------------------------
const W = 192; const H = 108;
const src = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const gx = Math.floor(x / (W / 8)); const gy = Math.floor(y / (H / 6));
  src[i] = (gx * 36 + gy * 7) % 256; src[i + 1] = (gy * 42 + gx * 3) % 256; src[i + 2] = ((x + y) * 255 / (W + H)) % 256; src[i + 3] = 255;
}
const render = (expr, T = 0.35) => { const out = new Uint8ClampedArray(W * H * 4); runEffect(src, out, W, H, T, expr); return out; };
const meanDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (W * H * 3); };
const allIds = [...parameterised.map((e) => e.id), 'blur', 'grain', 'pixel', 'vignette'];
for (const id of allIds) {
  const schema = fxSchema(id);
  const p = schema[0];
  const before = render(resolveFxExpr(id));
  // Either end of the range must move the render. (Resolution-relative parameters
  // can saturate at one end on a small chart — halftone cells at 192 px wide —
  // so the claim pinned here is that the parameter is wired through, at whichever
  // end the chart can see.)
  const dMin = meanDiff(before, render(resolveFxExpr(id, { [p.key]: p.min })));
  const dMax = meanDiff(before, render(resolveFxExpr(id, { [p.key]: p.max })));
  assert.notEqual(resolveFxExpr(id, { [p.key]: p.max }), resolveFxExpr(id), `${id}: a parameter change changes the expression`);
  assert.ok(Math.max(dMin, dMax) > 0.1, `${id}: ${p.key} visibly changes the render (min-end diff ${dMin.toFixed(3)}, max-end diff ${dMax.toFixed(3)})`);
}

// ---- The pass builder honours stored values (preview ≡ export: one builder) -
const mkProject = (clip, effectClips = []) => ({
  ...normalizeProject({}),
  media: [{ id: 'm', type: 'video', duration: 20 }],
  videoClips: [clip], overlayClips: [], effectClips, textClips: [], audioClips: [],
});
const baseClip = { id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: ['fx_mosaic60'] };
let proj = mkProject(baseClip);
assert.equal(pixelPasses(proj, proj.videoClips[0], 0, 1)[0].expr, GOLDEN_PIXEL.fx_mosaic60, 'no stored params: the pass is the historical expression');
proj = mkProject({ ...baseClip, fxParams: { fx_mosaic60: { cells: 20 } } });
assert.equal(pixelPasses(proj, proj.videoClips[0], 0, 1)[0].expr, resolveFxExpr('fx_mosaic60', { cells: 20 }), 'clip fxParams reach the pass builder');
proj = mkProject({ ...baseClip, effects: [] }, [{ id: 'e1', fx: 'grain', start: 0, duration: 10, params: { amount: 60 } }]);
const freePasses = pixelPasses(proj, proj.videoClips[0], 0, 1);
assert.ok(freePasses.some((p) => p.expr === resolveFxExpr('grain', { amount: 60 })), 'free effect clip params reach the pass builder');

// ---- Store round-trip: UI write shape → JSON → reload → identical passes ----
const fresh = (clip) => ({ past: [], present: mkProject(clip), future: [] });
const boundWrite = (clip, fx, key, v) => { // the exact write BoundFxCards performs
  const defs = fxDefaults(fx);
  const merged = { ...defs, ...(clip.fxParams?.[fx] || {}), [key]: v };
  for (const k of Object.keys(merged)) if (merged[k] === defs[k]) delete merged[k];
  const next = { ...(clip.fxParams || {}) };
  if (Object.keys(merged).length) next[fx] = merged; else delete next[fx];
  return { type: 'update', track: 'video', id: clip.id, patch: { fxParams: next } };
};
let st = fresh({ ...baseClip });
st = historyReducer(st, boundWrite(st.present.videoClips[0], 'fx_mosaic60', 'cells', 20));
assert.deepEqual(st.present.videoClips[0].fxParams, { fx_mosaic60: { cells: 20 } }, 'the parameter write lands sparsely (non-defaults only)');
const revived = normalizeProject(JSON.parse(JSON.stringify(st.present)));
assert.equal(pixelPasses(revived, revived.videoClips[0], 0, 1)[0].expr, resolveFxExpr('fx_mosaic60', { cells: 20 }), 'stored params survive save/load and render identically');
st = historyReducer(st, boundWrite(st.present.videoClips[0], 'fx_mosaic60', 'cells', 90));
assert.deepEqual(st.present.videoClips[0].fxParams, {}, 'returning a parameter to its default prunes it from storage');

// ---- WS2: removeEffect prunes all four instance maps ------------------------
const REGION = { shape: 'rect', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0.02, invert: false };
const loaded = {
  ...baseClip, effects: ['fx_rgb2', 'blur'],
  fxStrength: { fx_rgb2: 0.4, blur: 0.5 },
  fxRegions: { fx_rgb2: REGION, blur: REGION },
  fxTiming: { fx_rgb2: { start: 1, duration: 3 }, blur: { start: 0, duration: 6 } },
  fxParams: { fx_rgb2: { shift: 0.01 }, blur: { radius: 0.02 } },
};
st = fresh(loaded);
st = historyReducer(st, { type: 'removeEffect', id: 'video|a|fx_rgb2' });
const after = st.present.videoClips[0];
assert.deepEqual(after.effects, ['blur'], 'the effect leaves the clip');
for (const map of ['fxStrength', 'fxRegions', 'fxTiming', 'fxParams']) {
  assert.equal(after[map]?.fx_rgb2, undefined, `${map}: the removed effect's entry is pruned`);
  assert.notEqual(after[map]?.blur, undefined, `${map}: the surviving effect's entry is untouched`);
}
// Re-add: the instance must start from defaults — no ghost strength, no ghost params.
st = historyReducer(st, { type: 'update', track: 'video', id: 'a', patch: { effects: ['blur', 'fx_rgb2'] } });
const rePasses = pixelPasses(st.present, st.present.videoClips[0], 0, 1.5);
const rgbPass = rePasses.find((p) => p.expr.includes('C(W*'));
assert.ok(rgbPass, 'the re-added effect renders a pass');
assert.equal(rgbPass.expr, resolveFxExpr('fx_rgb2'), 're-added effect renders at default strength AND default parameters (no ghost)');

console.log('test-fx-params: PASS (schema lossless, params render, prune pinned)');
