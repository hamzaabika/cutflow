// Gap-build C — new pixel effects (CSV rows 161/165): Gentle Heat Haze and
// Motion Echo. Proves each one through the CPU reference (src/fx/run.js, the
// same expressions the preview compiles and the export prints): it parses,
// builds a shader, changes the picture, changes over time, and is distinct
// from its nearest neighbours (wave warp / ripple for haze, zoom trails for
// echo). Usage: node scripts/test-gapc-effects.mjs
import assert from 'node:assert/strict';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { EFFECTS } from '../src/effects.js';
import { parse } from '../src/fx/expr.js';
import { shaderSource } from '../src/fx/gl.js';
import { runEffect } from '../src/fx/run.js';

const W = 96, H = 54;
// A gradient test frame (x ramp + y ramp + a bright disc) so displacement,
// blur and ghosting all show up as pixel differences.
const src = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const d = Math.hypot(x - W * 0.7, y - H * 0.3);
  src[i] = Math.round((x / W) * 255);
  src[i + 1] = Math.round((y / H) * 255);
  src[i + 2] = d < 12 ? 240 : 40;
  src[i + 3] = 255;
}
const run = (expr, t) => runEffect(src, new Uint8ClampedArray(src.length), W, H, t, expr);
const meanDiff = (a, b) => {
  let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (W * H * 3);
};
const byId = (id) => PIXEL_EFFECTS.find((e) => e.id === id);

for (const [id, name, group] of [
  ['fx_heathaze', 'Gentle Heat Haze', 'Distortion & Mirror'],
  ['fx_motionecho', 'Motion Echo', 'Motion'],
]) {
  const e = byId(id);
  assert.ok(e, `${id} is in PIXEL_EFFECTS`);
  assert.equal(e.name, name, `${id} is named ${name}`);
  assert.ok(EFFECTS.find((x) => x.id === id && x.group === group), `${id} is in the Effects panel under ${group}`);
  parse(e.expr);
  assert.match(shaderSource(e.expr, 'effect'), /void main/, `${id} builds a shader`);
  const t0 = run(e.expr, 0), t1 = run(e.expr, 1.3);
  assert.ok(meanDiff(t0, src) > 0.5, `${id} changes the picture (diff ${meanDiff(t0, src).toFixed(2)})`);
  assert.ok(meanDiff(t0, t1) > 0.5, `${id} moves over time (diff ${meanDiff(t0, t1).toFixed(2)})`);
  console.log(`${id} ok (vs source ${meanDiff(t0, src).toFixed(2)}, over time ${meanDiff(t0, t1).toFixed(2)})`);
}
// Heat haze is not wave warp, ripple or jelly: distinct frames on the same source.
{
  const haze = run(byId('fx_heathaze').expr, 0.7);
  for (const other of ['fx_wavewarp', 'fx_pond', 'fx_jelly']) {
    const o = byId(other);
    assert.ok(o, `${other} exists for comparison`);
    const d = meanDiff(haze, run(o.expr, 0.7));
    assert.ok(d > 1, `heat haze differs from ${other} (diff ${d.toFixed(2)})`);
  }
  // And it is gentle: the displacement itself (measured straight from the
  // compiled expression's sample coordinates, not pixel diffs — the export's
  // truncating nearest sampler turns any sub-pixel shift into a whole-pixel
  // jump, which would flatten a pixel-diff ratio) grows toward the bottom.
  const { compile, parse } = await import('../src/fx/expr.js');
  const hazeFn = compile(parse(byId('fx_heathaze').expr));
  const W3 = 640, H3 = 360;
  const maxDx = (y) => {
    let m = 0;
    for (let x = 0; x < W3; x += 8) {
      let sx = 0, sy = 0;
      const env = { X: x, Y: y, W: W3, H: H3, T: 0.7, P: 0, ch: 0, reg: [], S: (a, b) => { sx = a; sy = b; return 128; }, L: () => 0, px: () => [0, 0, 0] };
      hazeFn(env);
      m = Math.max(m, Math.abs(sx - x), Math.abs(sy - y));
    }
    return m;
  };
  const topDx = maxDx(10), botDx = maxDx(H3 - 10);
  assert.ok(topDx < 0.5, `heat haze is calm at the top (max displacement ${topDx.toFixed(3)}px)`);
  assert.ok(botDx > 2, `heat haze shimmers at the bottom (max displacement ${botDx.toFixed(2)}px)`);
  console.log('heat haze distinct + bottom-weighted ok');
}
// Motion echo is not zoom trails: distinct frames; and more echoes = a
// longer trail (the echoes param really changes the render).
{
  const echo = run(byId('fx_motionecho').expr, 0.7);
  const zt = run(byId('fx_zoomtrails').expr, 0.7);
  assert.ok(meanDiff(echo, zt) > 1, `motion echo differs from zoom trails (diff ${meanDiff(echo, zt).toFixed(2)})`);
  const e1 = byId('fx_motionecho').make({ amount: 0.02, echoes: 1 });
  const e5 = byId('fx_motionecho').make({ amount: 0.02, echoes: 5 });
  assert.ok(meanDiff(run(e1, 0.7), run(e5, 0.7)) > 0.5, 'echoes param changes the trail');
  console.log('motion echo distinct + echoes param ok');
}
console.log('gapc-effects ok');
