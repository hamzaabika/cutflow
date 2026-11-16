// Real glow / bloom (CC-01), pure-node suite: the 11 starter presets, the
// multi-pass routing (pixelPasses -> { bloom } -> FxGL.bloom), keyframed
// intensity, zero-intensity identity, and the region fallback. The GPU
// pipeline itself (extract -> blur -> composite) is covered by the live
// CDP verification (preview + real export, bloom on vs off) — see the
// CC-01 report; this suite pins everything checkable without a GPU.
// Usage: node scripts/test-cc01-bloom.mjs
import assert from 'node:assert/strict';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { resolveFxExpr, resolveFxPass, bloomParams, hueRgb, isMultiPassFx, fxSchema, fxDefaults, mergeFxParams } from '../src/fx/params.js';
import { pixelPasses } from '../src/fx/apply.js';
import { runEffect } from '../src/fx/run.js';

const PRESETS = [
  ['fx_bloom_clean', 'Clean Soft Bloom'],
  ['fx_bloom_halation', 'Warm Halation'],
  ['fx_bloom_cool', 'Cool Diffuse'],
  ['fx_bloom_neon', 'Neon Sign'],
  ['fx_bloom_edge', 'Edge Glow'],
  ['fx_bloom_dream', 'Dream'],
  ['fx_bloom_color', 'Colored Bloom'],
  ['fx_bloom_chroma', 'Chromatic Neon'],
  ['fx_bloom_halo', 'Highlight Halo'],
  ['fx_bloom_textpulse', 'Text Glow Pulse'],
  ['fx_bloom_sweep', 'Gentle Light Sweep'],
];
const CONTROLS = ['threshold', 'softness', 'radius', 'intensity', 'hue', 'saturation', 'blend', 'mask', 'quality'];

// ---- Registry: the 11 named presets, appended at the end of the catalog ----
const byId = Object.fromEntries(PIXEL_EFFECTS.map((e) => [e.id, e]));
for (const [id, name] of PRESETS) {
  const e = byId[id];
  assert.ok(e, `${id} is in PIXEL_EFFECTS`);
  assert.equal(e.name, name, `${id} name`);
  assert.equal(e.multiPass, 'bloom', `${id} is a multi-pass bloom effect`);
  assert.ok(isMultiPassFx(id), `${id} resolves as multi-pass`);
}
const firstBloom = PIXEL_EFFECTS.findIndex((e) => e.id === PRESETS[0][0]);
assert.ok(firstBloom >= 0, 'bloom presets present in PIXEL_EFFECTS');
assert.deepEqual(
  PIXEL_EFFECTS.slice(firstBloom, firstBloom + 11).map((e) => e.id),
  PRESETS.map(([id]) => id),
  'the 11 bloom presets are contiguous',
);
assert.ok(PIXEL_EFFECTS.length - (firstBloom + 11) <= 4,
  'the bloom presets sit at the end of PIXEL_EFFECTS (at most the 4 analog effects follow)');
assert.equal(new Set(PIXEL_EFFECTS.map((e) => e.id)).size, PIXEL_EFFECTS.length, 'effect ids unique');
assert.equal(new Set(PIXEL_EFFECTS.map((e) => e.name)).size, PIXEL_EFFECTS.length, 'effect names unique');
// The old single-pass glow approximations are untouched, and are NOT bloom.
for (const id of ['fx_bloom1', 'fx_bloom2', 'fx_glowpulse', 'fx_halo']) {
  assert.ok(byId[id] && !byId[id].multiPass, `${id} stays a plain expression effect`);
}

// ---- Controls: the §4 control set on every preset, with sane defaults ----
for (const [id] of PRESETS) {
  const schema = fxSchema(id);
  assert.ok(schema, `${id} has a parameter schema`);
  for (const key of CONTROLS) {
    const p = schema.find((x) => x.key === key);
    assert.ok(p, `${id} exposes ${key}`);
    assert.ok(p.def >= p.min && p.def <= p.max, `${id}.${key} default ${p.def} inside [${p.min}, ${p.max}]`);
  }
  const defs = fxDefaults(id);
  assert.deepEqual(Object.keys(defs).sort(), [...new Set(schema.map((p) => p.key))].sort(), `${id} defaults cover the schema`);
}
assert.ok(fxSchema('fx_bloom_textpulse').some((p) => p.key === 'pulse'), 'Text Glow Pulse exposes pulse');
assert.ok(fxSchema('fx_bloom_sweep').some((p) => p.key === 'sweep'), 'Gentle Light Sweep exposes sweep');
assert.ok(!fxSchema('fx_bloom_clean').some((p) => p.key === 'pulse' || p.key === 'sweep'), 'Clean Soft Bloom has no pulse/sweep knobs');

// ---- Colour: hue + saturation resolve to the tint the shader composites ----
const warm = hueRgb(28, 0.85);
assert.ok(warm[0] > warm[1] && warm[1] > warm[2], `Warm Halation tint is orange (${warm.map((v) => v.toFixed(2))})`);
const cool = hueRgb(215, 0.7);
assert.ok(cool[2] > cool[0], `Cool Diffuse tint is blue (${cool.map((v) => v.toFixed(2))})`);
const neon = hueRgb(315, 1);
assert.ok(neon[0] > 0.9 && neon[2] > 0.7 && neon[1] < 0.3, `Neon Sign tint is magenta (${neon.map((v) => v.toFixed(2))})`);
assert.deepEqual(bloomParams('fx_bloom_halation', undefined).color, warm, 'bloomParams carries the resolved tint');

// ---- Routing: pixelPasses emits a { bloom } pass (not an expression) ----
const clip = (effects, extra = {}) => ({ id: 'c1', effects, fxTiming: {}, ...extra });
const project = { videoClips: [], effectClips: [] };
{
  const passes = pixelPasses(project, clip(['fx_bloom_clean']), 0, 0.5);
  assert.equal(passes.length, 1, 'one bloom pass for one bloom clip');
  assert.ok(passes[0].bloom, 'the pass is a { bloom } pass');
  assert.equal(typeof passes[0].bloom.threshold, 'number', 'bloom pass carries resolved numbers');
  assert.equal(passes[0].T, 0.5, 'bloom pass time is clip-local');
}
// Stored parameter values reach the pass, clamped to the schema.
{
  const passes = pixelPasses(project, clip(['fx_bloom_neon'], { fxParams: { fx_bloom_neon: { intensity: 2, threshold: 5, hue: 315 } } }), 0, 0);
  assert.equal(passes[0].bloom.intensity, 2, 'stored intensity reaches the pass');
  assert.equal(passes[0].bloom.threshold, 1, 'stored threshold is clamped to the schema max');
}

// ---- Keyframes: fxKeys intensity interpolates the bloom intensity ----
{
  const keys = [{ t: 0, v: 0 }, { t: 2, v: 1 }];
  const at = (lt) => pixelPasses(project, clip(['fx_bloom_clean'], { fxKeys: { fx_bloom_clean: keys } }), 0, lt)[0].bloom.intensity;
  const def = fxDefaults('fx_bloom_clean').intensity;
  assert.equal(pixelPasses(project, clip(['fx_bloom_clean'], { fxKeys: { fx_bloom_clean: keys } }), 0, 0).length, 0,
    'strength 0 at the first key removes the pass entirely');
  assert.ok(Math.abs(at(1) - def * 0.5) < 1e-9, `intensity interpolates to half at t=1 (got ${at(1)})`);
  assert.equal(at(2), def, 'intensity reaches the default at the last key');
  // Static strength scales the same way.
  const s = pixelPasses(project, clip(['fx_bloom_clean'], { fxStrength: { fx_bloom_clean: 0.5 } }), 0, 0)[0].bloom.intensity;
  assert.ok(Math.abs(s - def * 0.5) < 1e-9, 'static strength scales the intensity');
}
// Zero intensity renders unchanged: the resolved intensity is 0 (gl.js
// then no-ops the pass), and the single-pass fallback expression with
// intensity 0 is the identity on pixels.
{
  assert.equal(bloomParams('fx_bloom_clean', { intensity: 0 }, 1).intensity, 0, 'zero intensity resolves to 0');
  const W = 64, H = 36;
  const src = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < src.length; i += 4) { src[i] = 200; src[i + 1] = 40; src[i + 2] = 90; src[i + 3] = 255; }
  const out = new Uint8ClampedArray(src.length);
  const zero = { ...fxDefaults('fx_bloom_clean'), intensity: 0 };
  runEffect(src, out, W, H, 0.6, byId.fx_bloom_clean.make(zero));
  let d = 0;
  for (let i = 0; i < src.length; i++) d += Math.abs(out[i] - src[i]);
  assert.equal(d / src.length, 0, 'fallback expression with intensity 0 is the identity');
}
// Region: a regioned bloom falls back to the single-pass expression, wrapped
// (the multi-pass pipeline has no region-mask texture — the same documented
// limit as a LUT pass), so the region is honoured instead of silently dropped.
{
  const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0.05, shape: 'rect', invert: false };
  const passes = pixelPasses(project, clip(['fx_bloom_clean'], { fxRegions: { fx_bloom_clean: region } }), 0, 0.5);
  assert.equal(passes.length, 1, 'one pass for the regioned bloom');
  assert.ok(passes[0].expr && !passes[0].bloom, 'regioned bloom renders through its fallback expression');
  assert.ok(passes[0].expr.includes('ld(9)'), 'the fallback is region-wrapped (register 9 mask)');
}
// Effects-track objects route the same way.
{
  const p2 = { videoClips: [], effectClips: [{ id: 'e1', fx: 'fx_bloom_warm', start: 0, duration: 2 }] };
  // (fx_bloom_warm does not exist — a typo'd track object must not crash the pass builder)
  const none = pixelPasses(p2, clip([]), 0, 0.5);
  assert.equal(none.length, 0, 'unknown track effect emits no pass');
  const p3 = { videoClips: [], effectClips: [{ id: 'e1', fx: 'fx_bloom_cool', start: 0, duration: 2, params: { intensity: 1.4 } }] };
  const free = pixelPasses(p3, clip([]), 0, 0.5);
  assert.equal(free.length, 1, 'one bloom pass for the Effects-track object');
  assert.equal(free[0].bloom.intensity, 1.4, 'track params reach the bloom pass');
}
// The fallback expression is a real glow on pixels (also pinned pairwise by
// test-effects-library): bright areas lift, tinted, and each preset's
// fallback differs from the plain picture.
{
  const W = 192, H = 108;
  const src = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    src[i] = 240; src[i + 1] = 220; src[i + 2] = 180; src[i + 3] = 255;
  }
  const out = new Uint8ClampedArray(src.length);
  runEffect(src, out, W, H, 0.6, byId.fx_bloom_clean.expr);
  let lift = 0;
  for (let i = 0; i < src.length; i += 4) lift += out[i] + out[i + 1] + out[i + 2] - (src[i] + src[i + 1] + src[i + 2]);
  assert.ok(lift > 0, 'fallback glow lifts bright pixels');
  // Mask source: Text Glow Pulse is alpha-gated (mask 1) so it blooms
  // opaque layers (text) rather than the whole luma field.
  assert.equal(bloomParams('fx_bloom_textpulse', undefined).mask, 1, 'Text Glow Pulse masks by alpha');
  assert.equal(bloomParams('fx_bloom_clean', undefined).mask, 0, 'Clean Soft Bloom masks by luma');
  // resolveFxExpr still returns the fallback for thumbnails / self-test.
  assert.equal(typeof resolveFxExpr('fx_bloom_clean', undefined), 'string', 'fallback expression resolves');
  assert.ok(resolveFxPass('fx_bloom_clean', undefined).bloom, 'resolveFxPass prefers the bloom pass');
  assert.ok(resolveFxPass('fx_vhs', undefined).expr, 'resolveFxPass returns expressions for plain effects');
  assert.equal(resolveFxPass('no_such_fx', undefined), null, 'unknown id resolves to null');
  assert.deepEqual(mergeFxParams('fx_bloom_clean', { threshold: 'junk', hue: 45 }), { ...fxDefaults('fx_bloom_clean') }, 'non-numeric stored values fall back to defaults');
}

console.log(`test-cc01-bloom: PASS (${PRESETS.length} presets, multi-pass routing + keyframes + zero-intensity + region fallback pinned)`);
