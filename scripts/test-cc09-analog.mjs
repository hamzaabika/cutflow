// Analog effects (CC-09), pure-node suite: the unified CRT/VHS, the unified
// Glass & Prism, Stroke Reveal and Shape Morph — rendered through the CPU
// reference renderer with measurements that prove each one does what its
// name says (not a preset look). The pieces they unify stay in place with
// their original expressions. GPU/preview/export parity is covered by the
// live CDP verification — see the CC-09 report.
// Usage: node scripts/test-cc09-analog.mjs
import assert from 'node:assert/strict';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { resolveFxExpr, fxSchema, fxDefaults, mergeFxParams } from '../src/fx/params.js';
import { runEffect } from '../src/fx/run.js';

const byId = Object.fromEntries(PIXEL_EFFECTS.map((e) => [e.id, e]));
const W = 192, H = 108;
const meanAbs = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

// ---- Rich asymmetric chart (same construction as test-effects-library) ----
const chart = new Uint8ClampedArray(W * H * 4);
{
  const cell = Math.round(W / 16);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r = 40 + x * 0.9 + y * 0.35, g = 200 - x * 0.55 + y * 0.45, b = 90 + y * 1.2 - x * 0.25;
    const blob = Math.max(0, 1 - Math.hypot(x - W / 4, y - H * 0.3) / (W / 5));
    r += blob * 120; g += blob * 40; b -= blob * 30;
    if (x >= W * 0.58) { const c = ((x - W * 0.58) / cell | 0) + (y / cell | 0); if (c % 2) { r = 235; g = 30; b = 60; } else { r = 25; g = 210; b = 225; } }
    if (y >= H * 0.7 && y < H * 0.85) { const s = (x / (W / 24) | 0) % 2; r = s ? 245 : 35; g = s ? 225 : 45; b = s ? 60 : 190; }
    chart[i] = Math.max(0, Math.min(255, r)); chart[i + 1] = Math.max(0, Math.min(255, g)); chart[i + 2] = Math.max(0, Math.min(255, b)); chart[i + 3] = 255;
  }
}
// ---- Smooth frame (no sharp edges): isolates glows / warps from content ----
const smooth = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  smooth[i] = 110 + 50 * Math.sin((x / W) * 5) + 20 * Math.cos((y / H) * 4);
  smooth[i + 1] = 130 + 40 * Math.cos((x / W) * 3 + 1) + 25 * Math.sin((y / H) * 6);
  smooth[i + 2] = 150 + 45 * Math.sin(((x + y) / (W + H)) * 7);
  smooth[i + 3] = 255;
}
const render = (id, src, T, params) => {
  const out = new Uint8ClampedArray(src.length);
  runEffect(src, out, W, H, T, resolveFxExpr(id, params));
  return out;
};
const exprOf = (id, params) => resolveFxExpr(id, params);

// ---- Registry: the 4 unified effects, appended at the end of the catalog ----
const FOUR = [
  ['fx_crtvhs', 'CRT/VHS'],
  ['fx_glassprism', 'Glass & Prism'],
  ['fx_strokereveal', 'Stroke Reveal'],
  ['fx_shapemorph', 'Shape Morph'],
];
for (const [id, name] of FOUR) {
  assert.ok(byId[id], `${id} is in PIXEL_EFFECTS`);
  assert.equal(byId[id].name, name, `${id} name`);
  assert.ok(!byId[id].multiPass, `${id} is a single expression effect`);
  assert.ok(fxSchema(id)?.length >= 2, `${id} exposes parameters`);
}
assert.deepEqual(
  PIXEL_EFFECTS.slice(-4).map((e) => e.id),
  FOUR.map(([id]) => id),
  'the 4 analog effects are the last entries of PIXEL_EFFECTS',
);

// ---- The pieces stay in place, with their original expressions ----
const PIECES = [
  ['fx_vhs', 'fract(T/2.3)'],
  ['fx_vhstrack', 'fract(T*0.14)'],
  ['fx_prism', 'C(0.025, 0, -0.025)'],
  ['fx_prismglow', 'C(W*0.008, 0, -W*0.008)'],
  ['fx_stainedglass', 'hash(ld(1)*3.7 + ld(2)*9.1)'],
  ['fx_frost', 'hash(floor(X/3)*1.37 + floor(Y/3)*2.11)'],
];
for (const [id, sig] of PIECES) {
  assert.ok(byId[id], `${id} (unified piece) is still in the catalog`);
  assert.ok(byId[id].expr.includes(sig), `${id} keeps its original expression (${sig})`);
}

// ---- (a) CRT/VHS: scanlines + curvature + chromatic aberration + tracking ----
{
  const out = render('fx_crtvhs', chart, 0.6);
  assert.ok(meanAbs(out, chart) > 1, 'CRT/VHS visibly changes the picture');
  // Scanlines: alternate rows darken, so the row-to-row mean jumps far more
  // than on the (smooth) source chart.
  const rowJump = (buf) => {
    let s = 0;
    for (let y = 0; y + 1 < H; y++) {
      let a = 0, b = 0;
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; a += buf[i] + buf[i + 1] + buf[i + 2]; const j = ((y + 1) * W + x) * 4; b += buf[j] + buf[j + 1] + buf[j + 2]; }
      s += Math.abs(a - b) / W / 3;
    }
    return s / (H - 1);
  };
  assert.ok(rowJump(out) > rowJump(chart) * 2, `scanlines double the row-to-row jump (${rowJump(out).toFixed(2)} vs ${rowJump(chart).toFixed(2)})`);
  // Curvature: corners sample from inside the frame, so a curvature-0 render
  // and the default differ in the corners.
  const noCurve = render('fx_crtvhs', chart, 0.6, { ...fxDefaults('fx_crtvhs'), curvature: 0 });
  const cornerMad = (a, b) => {
    let s = 0, n = 0;
    for (const [x0, y0] of [[0, 0], [W - 16, 0], [0, H - 16], [W - 16, H - 16]])
      for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) {
        const i = (y * W + x) * 4;
        s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3;
      }
    return s / n;
  };
  assert.ok(cornerMad(out, noCurve) > 1, `curvature moves the corners (${cornerMad(out, noCurve).toFixed(2)})`);
  // Chromatic aberration: zeroing it changes the render at high-contrast edges.
  const noCA = render('fx_crtvhs', chart, 0.6, { ...fxDefaults('fx_crtvhs'), aberration: 0 });
  assert.ok(meanAbs(out, noCA) > 0.5, `aberration is a live control (${meanAbs(out, noCA).toFixed(2)})`);
  // Tracking + noise: two instants differ (the band has moved, the grain changed).
  const later = render('fx_crtvhs', chart, 1.5);
  assert.ok(meanAbs(out, later) > 0.5, `tracking/noise move with time (${meanAbs(out, later).toFixed(2)})`);
  // Zeroing tracking+noise+scanlines leaves a near-static picture.
  const still = render('fx_crtvhs', chart, 0.6, { ...fxDefaults('fx_crtvhs'), tracking: 0, noise: 0, scanlines: 0 });
  const stillLater = render('fx_crtvhs', chart, 1.5, { ...fxDefaults('fx_crtvhs'), tracking: 0, noise: 0, scanlines: 0 });
  assert.ok(meanAbs(still, stillLater) < meanAbs(out, later), 'tracking/noise off calms the time variation');
}

// ---- (b) Glass & Prism: refraction + dispersion + frost + facets ----
{
  const out = render('fx_glassprism', chart, 0.6);
  assert.ok(meanAbs(out, chart) > 1, 'Glass & Prism visibly changes the picture');
  // Each control moves the picture (facets is 0 by default, so turn it ON).
  const noRef = render('fx_glassprism', chart, 0.6, { ...fxDefaults('fx_glassprism'), refraction: 0 });
  assert.ok(meanAbs(out, noRef) > 0.5, `refraction is a live control (${meanAbs(out, noRef).toFixed(2)})`);
  const noDisp = render('fx_glassprism', chart, 0.6, { ...fxDefaults('fx_glassprism'), dispersion: 0 });
  assert.ok(meanAbs(out, noDisp) > 0.5, `dispersion is a live control (${meanAbs(out, noDisp).toFixed(2)})`);
  const noFrost = render('fx_glassprism', chart, 0.6, { ...fxDefaults('fx_glassprism'), frost: 0 });
  assert.ok(meanAbs(out, noFrost) > 0.5, `frost is a live control (${meanAbs(out, noFrost).toFixed(2)})`);
  const faceted = render('fx_glassprism', chart, 0.6, { ...fxDefaults('fx_glassprism'), facets: 1 });
  assert.ok(meanAbs(out, faceted) > 0.5, `facets change the field (${meanAbs(out, faceted).toFixed(2)})`);
  // Dispersion separates the channels: R and B sample from different
  // places, so at a hard red/blue boundary each channel samples the wrong
  // side and a dark seam appears where the source is pure red or pure blue
  // (R+B = 255 on both sides, never near-black).
  const split = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (x < W / 2) { split[i] = 255; split[i + 1] = 0; split[i + 2] = 0; }
    else { split[i] = 0; split[i + 1] = 0; split[i + 2] = 255; }
    split[i + 3] = 255;
  }
  const splitOut = render('fx_glassprism', split, 0.6);
  let seam = 0;
  for (let y = 0; y < H; y++) for (let x = Math.floor(W / 2) - 4; x < Math.floor(W / 2) + 4; x++) {
    const i = (y * W + x) * 4;
    if (splitOut[i] < 40 && splitOut[i + 2] < 40) seam++;
  }
  assert.ok(seam > 5, `dispersion opens a dark seam at the red/blue boundary (${seam} near-black seam pixels)`);
}

// ---- (c) Stroke Reveal: the stroke actually draws on over time ----
{
  const mad = (T) => meanAbs(render('fx_strokereveal', chart, T), chart);
  assert.ok(mad(0) > 30, `at T=0 the picture is still dimmed grey (MAD ${mad(0).toFixed(1)})`);
  assert.ok(mad(0.5) > mad(1.0) && mad(1.0) > mad(2.0), `the reveal progresses with time (${mad(0.5).toFixed(1)} > ${mad(1.0).toFixed(1)} > ${mad(2.0).toFixed(1)})`);
  assert.ok(mad(2.5) < 2, `once drawn, the picture is back (MAD ${mad(2.5).toFixed(2)})`);
  // The edge glow: mid-stroke some pixels are brighter than the source.
  const mid = render('fx_strokereveal', chart, 1.0);
  let hottest = 0;
  for (let i = 0; i < mid.length; i++) hottest = Math.max(hottest, mid[i] - chart[i]);
  assert.ok(hottest > 20, `the brush edge glows (+${hottest} over source)`);
  // Speed drives the mask: fast draws on by T=0.5, slow has barely started.
  const fast = meanAbs(render('fx_strokereveal', chart, 0.5, { ...fxDefaults('fx_strokereveal'), speed: 2 }), chart);
  const slow = meanAbs(render('fx_strokereveal', chart, 0.5, { ...fxDefaults('fx_strokereveal'), speed: 0.1 }), chart);
  assert.ok(fast < 5 && slow > 30, `speed controls the draw-on (fast MAD ${fast.toFixed(1)}, slow MAD ${slow.toFixed(1)})`);
}

// ---- (c) Shape Morph: the lens boundary genuinely changes shape ----
{
  // Glow peak along the 45° diagonal from the centre: on the smooth frame
  // the added edge glow is isolated (output minus source). Circle (n=2)
  // peaks at t≈1.41, rounded square (n=8) at t≈1.83.
  const peakT = (T) => {
    const out = render('fx_shapemorph', smooth, T);
    let best = -1, bestT = 0;
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * 2;
      const x = Math.round(W / 2 + (t * W) / 4), y = Math.round(H / 2 + (t * H) / 4);
      const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
      const glow = (out[i] - smooth[i]) + (out[i + 1] - smooth[i + 1]) + (out[i + 2] - smooth[i + 2]);
      if (glow > best) { best = glow; bestT = t; }
    }
    return bestT;
  };
  const p0 = peakT(0);
  const p25 = peakT(2.5);
  assert.ok(p0 < 1.6 && p25 > 1.65, `the glowing boundary moves outward as it morphs (t=${p0} -> ${p25})`);
  assert.ok(p25 > p0, 'the boundary morphs circle -> rounded square');
  const m0 = render('fx_shapemorph', chart, 0);
  const m25 = render('fx_shapemorph', chart, 2.5);
  assert.ok(meanAbs(m0, m25) > 1, `the morph changes the picture (${meanAbs(m0, m25).toFixed(2)})`);
  const noWarp = render('fx_shapemorph', chart, 1.0, { ...fxDefaults('fx_shapemorph'), amount: 0 });
  const warped = render('fx_shapemorph', chart, 1.0);
  assert.ok(meanAbs(noWarp, warped) > 0.5, `warp amount is a live control (${meanAbs(noWarp, warped).toFixed(2)})`);
  // Params clamp like every other effect.
  assert.equal(mergeFxParams('fx_shapemorph', { amount: 9 }).amount, 1, 'amount clamps to the schema max');
  assert.ok(exprOf('fx_crtvhs', undefined).includes('st(8,'), 'CRT/VHS uses registers within r0..r8 (r9 stays free for the region mask)');
  assert.ok(!exprOf('fx_glassprism', undefined).includes('ld(9)'), 'Glass & Prism never touches r9');
  assert.ok(!exprOf('fx_strokereveal', undefined).includes('ld(9)'), 'Stroke Reveal never touches r9');
  assert.ok(!exprOf('fx_shapemorph', undefined).includes('ld(9)'), 'Shape Morph never touches r9');
}

console.log('test-cc09-analog: PASS (unified CRT/VHS + Glass & Prism + Stroke Reveal + Shape Morph measured on pixels; pieces intact)');
