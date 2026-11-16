// P2-04 / P2-05 — parametric wipes and motion transitions, CPU-reference checks.
// The shape must match the name (clock = a sweeping hand, gradient = a travelling
// band, luma = bright areas first, mask = a growing shape), feather must soften the
// edge in both render paths (one expression drives both), direction must flip the
// travel, and the motion transitions must never reveal a black frame.
// Usage: node scripts/test-p2b-wipes.mjs
import assert from 'node:assert/strict';
import { fxTransition } from '../src/fx/catalog.js';
import { mergeTrParams, transitionExpr, trSchema } from '../src/fx/params.js';
import { parse } from '../src/fx/expr.js';
import { shaderSource } from '../src/fx/gl.js';
import { runTransition } from '../src/fx/run.js';

const W = 96;
const H = 54;
const solid = (r, g, b) => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return d;
};
const A = solid(255, 0, 0); // outgoing: red
const B = solid(0, 0, 255); // incoming: blue
// Outgoing clip whose luma is a left/right step: black left, white right.
const A_STEP = (() => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const v = x < W / 2 ? 0 : 255;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
})();

const frame = (a, b, P, expr) => runTransition(a, b, new Uint8ClampedArray(a.length), W, H, P, expr);
const isB = (f, i) => f[i * 4 + 2] > 200 && f[i * 4] < 55; // (near-)pure blue
const isA = (f, i) => f[i * 4] > 200 && f[i * 4 + 2] < 55; // (near-)pure red
const isBlend = (f, i) => !isA(f, i) && !isB(f, i);
// Fraction of pixels in a region that are (near-)pure B.
const fracB = (f, x0, x1, y0, y1) => {
  let n = 0; let c = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (isB(f, y * W + x)) c++; }
  return c / n;
};
const fracBlend = (f) => {
  let c = 0;
  for (let i = 0; i < W * H; i++) if (isBlend(f, i)) c++;
  return c / (W * H);
};
const countBlack = (f) => {
  let c = 0;
  for (let i = 0; i < W * H; i++) if (f[i * 4] < 10 && f[i * 4 + 1] < 10 && f[i * 4 + 2] < 10) c++;
  return c;
};
const close = (x, y) => { let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length < 2; };

// --- Resolver ---------------------------------------------------------------
assert.equal(transitionExpr(null), null);
assert.equal(transitionExpr({ type: 'no-such-transition' }), null);
assert.ok(trSchema('fx_clockwipe')?.some((p) => p.key === 'feather'), 'clock wipe declares feather');
assert.ok(trSchema('fx_gradientwipe')?.some((p) => p.key === 'direction'), 'gradient wipe declares direction');
// B-F05: every transition carries the generic schema (stored-only slots);
// an unparameterised transition has no LIVE param, but the schema exists.
const zoomSchema = trSchema('fx_zoomin');
assert.ok(Array.isArray(zoomSchema) && zoomSchema.some((p) => p.key === 'strength'), 'unparameterised transitions carry the generic schema');
assert.ok(!zoomSchema.some((p) => p.live), 'none of the generic schema is live/wired for fx_zoomin');
assert.deepEqual(mergeTrParams('fx_clockwipe', { direction: 'sideways', feather: 99 }), { direction: 'cw', feather: 0.25, strength: 1 });
assert.deepEqual(mergeTrParams('fx_clockwipe', { direction: 'ccw', feather: 0.1 }), { direction: 'ccw', feather: 0.1, strength: 1 });

// The default clock wipe is byte-identical to the pre-parameter expression, so
// projects saved before parameters existed render exactly as before.
const CLOCK_LEGACY = 'st(0, mod(atan2(X - W/2, -(Y - H/2)) + 6.28319, 6.28319)/6.28319); if(lt(ld(0), P), B(X, Y), A(X, Y))';
assert.equal(transitionExpr({ type: 'fx_clockwipe' }), CLOCK_LEGACY);
assert.equal(fxTransition('fx_clockwipe').expr, CLOCK_LEGACY);

// --- Shape checks (P2-04) ----------------------------------------------------
const NEW = ['fx_clockwipe', 'fx_gradientwipe', 'fx_lumawipe', 'fx_maskreveal',
  'fx_seamlesszoom', 'fx_seamlesszoomout', 'fx_pushsmooth', 'fx_pullsmooth'];
for (const id of NEW) {
  const expr = transitionExpr({ type: id });
  assert.ok(expr, `${id} resolves`);
  parse(expr);
  assert.match(shaderSource(expr, 'transition'), /void main/, `${id} builds a shader`);
  assert.ok(close(frame(A, B, 0, expr), A), `${id} starts exactly on A`);
  assert.ok(close(frame(A, B, 1, expr), B), `${id} ends exactly on B`);
}

// Clock wipe, clockwise from the top: at P = 0.5 the right half (12 o'clock round
// to 6 o'clock) is B and the left half is still A.
{
  const f = frame(A, B, 0.5, transitionExpr({ type: 'fx_clockwipe' }));
  assert.ok(fracB(f, W / 2, W, 0, H) > 0.9, `clock cw: right half is B (${fracB(f, W / 2, W, 0, H).toFixed(2)})`);
  assert.ok(fracB(f, 0, W / 2, 0, H) < 0.1, `clock cw: left half is A (${fracB(f, 0, W / 2, 0, H).toFixed(2)})`);
  assert.equal(fracBlend(f), 0, 'clock cw default edge is hard');
}
// Counter-clockwise is the mirror: left half B, right half A.
{
  const f = frame(A, B, 0.5, transitionExpr({ type: 'fx_clockwipe', params: { direction: 'ccw' } }));
  assert.ok(fracB(f, 0, W / 2, 0, H) > 0.9, 'clock ccw: left half is B');
  assert.ok(fracB(f, W / 2, W, 0, H) < 0.1, 'clock ccw: right half is A');
}
// Feather softens the edge: blended pixels appear, and grow with the feather.
{
  const hard = frame(A, B, 0.5, transitionExpr({ type: 'fx_clockwipe', params: { feather: 0 } }));
  const soft = frame(A, B, 0.5, transitionExpr({ type: 'fx_clockwipe', params: { feather: 0.15 } }));
  assert.equal(fracBlend(hard), 0, 'feather 0: no blended pixels');
  assert.ok(fracBlend(soft) > 0.05, `feather 0.15: blended band present (${fracBlend(soft).toFixed(2)})`);
  assert.ok(close(frame(A, B, 0, transitionExpr({ type: 'fx_clockwipe', params: { feather: 0.15 } })), A), 'feathered clock still starts on A');
  assert.ok(close(frame(A, B, 1, transitionExpr({ type: 'fx_clockwipe', params: { feather: 0.15 } })), B), 'feathered clock still ends on B');
}
// Gradient wipe: at P = 0.5 about half the frame is B; direction flips the side.
{
  const f = frame(A, B, 0.5, transitionExpr({ type: 'fx_gradientwipe' }));
  const b = fracB(f, 0, W, 0, H);
  assert.ok(b > 0.35 && b < 0.65, `gradient wipe covers ~half at P=0.5 (${b.toFixed(2)})`);
  const l = frame(A, B, 0.5, transitionExpr({ type: 'fx_gradientwipe', params: { direction: 'from-left' } }));
  const r = frame(A, B, 0.5, transitionExpr({ type: 'fx_gradientwipe', params: { direction: 'from-right' } }));
  assert.ok(fracB(l, 0, W / 2, 0, H) > fracB(l, W / 2, W, 0, H), 'from-left: B leads on the left');
  assert.ok(fracB(r, W / 2, W, 0, H) > fracB(r, 0, W / 2, 0, H), 'from-right: B leads on the right');
}
// Luma wipe: bright areas of the outgoing clip flip first — with a black/white
// step source, the white (right) half is B at P = 0.5 and the black half is A.
{
  const f = frame(A_STEP, B, 0.5, transitionExpr({ type: 'fx_lumawipe' }));
  assert.ok(fracB(f, W / 2, W, 0, H) > 0.9, `luma wipe: bright half is B (${fracB(f, W / 2, W, 0, H).toFixed(2)})`);
  assert.ok(fracB(f, 0, W / 2, 0, H) < 0.1, `luma wipe: dark half is A (${fracB(f, 0, W / 2, 0, H).toFixed(2)})`);
}
// Mask reveal from the centre: the middle is B at P = 0.5, the corners are A;
// from the edges it is the other way round.
{
  const c = frame(A, B, 0.5, transitionExpr({ type: 'fx_maskreveal' }));
  assert.ok(fracB(c, W / 2 - 8, W / 2 + 8, H / 2 - 8, H / 2 + 8) > 0.9, 'mask reveal: centre is B');
  assert.ok(fracB(c, 0, 6, 0, 6) < 0.1 && fracB(c, W - 6, W, H - 6, H) < 0.1, 'mask reveal: corners are A');
  const e = frame(A, B, 0.5, transitionExpr({ type: 'fx_maskreveal', params: { direction: 'edges' } }));
  assert.ok(fracB(e, 0, 6, 0, 6) > 0.9, 'mask reveal from edges: corners are B');
  assert.ok(fracB(e, W / 2 - 8, W / 2 + 8, H / 2 - 8, H / 2 + 8) < 0.1, 'mask reveal from edges: centre is A');
}

// --- Motion transitions (P2-05) ---------------------------------------------
// No black frame at any sampled progress, and the move is real (mid-frame differs
// from both ends) without freezing on a blur: at P = 0.05 / 0.95 the picture is
// nearly sharp (blur is coupled to the eased speed, ~0 at the ends).
for (const id of ['fx_seamlesszoom', 'fx_seamlesszoomout', 'fx_pushsmooth', 'fx_pullsmooth', 'fx_whipleft', 'fx_whipright']) {
  const expr = transitionExpr({ type: id });
  for (const P of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const f = frame(A, B, P, expr);
    assert.equal(countBlack(f), 0, `${id}@${P}: no black pixels`);
  }
  const mid = frame(A, B, 0.5, expr);
  assert.ok(!close(mid, A) && !close(mid, B), `${id} moves mid-way`);
}
// Smooth push: at P = 0.5 the seam sits mid-frame (Bézier travel smooth(0,1,0.5)
// = 0.5), B on the right, A on the left.
{
  const f = frame(A, B, 0.5, transitionExpr({ type: 'fx_pushsmooth' }));
  assert.ok(fracB(f, W / 2 + 8, W, 0, H) > 0.8, 'push left: right side is B at mid-way');
  assert.ok(fracB(f, 0, W / 2 - 8, 0, H) < 0.2, 'push left: left side is A at mid-way');
  const g = frame(A, B, 0.5, transitionExpr({ type: 'fx_pullsmooth' }));
  assert.ok(fracB(g, 0, W / 2 - 8, 0, H) > 0.8, 'pull right: left side is B at mid-way');
  assert.ok(fracB(g, W / 2 + 8, W, 0, H) < 0.2, 'pull right: right side is A at mid-way');
}
console.log('P2-B wipes + motion transitions OK');
