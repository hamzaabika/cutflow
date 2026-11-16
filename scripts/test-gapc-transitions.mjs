// Gap-build C — new transitions (CSV rows 61/62/77/79/100/109): Smooth Push Up,
// Smooth Push Down, Parallax Zoom, Perspective Push, Motion Match Blur, Signal
// Line Cut. Proves each one through the CPU reference (src/fx/run.js, the same
// expressions the preview compiles and the export prints): it parses, builds a
// shader, starts exactly on A, ends exactly on B, moves in the named direction,
// and is a real motion at mid-cut — not a dead tile. Usage: node scripts/test-gapc-transitions.mjs
import assert from 'node:assert/strict';
import { fxTransition } from '../src/fx/catalog.js';
import { TRANSITIONS } from '../src/effects.js';
import { COLLECTION_ITEMS, directionGroupFor } from '../src/fx/collections.js';
import { parse } from '../src/fx/expr.js';
import { shaderSource } from '../src/fx/gl.js';
import { runTransition } from '../src/fx/run.js';

const IDS = [
  ['fx_pushsmoothup', 'Smooth Push Up'],
  ['fx_pushsmoothdown', 'Smooth Push Down'],
  ['fx_parallaxzoom', 'Parallax Zoom'],
  ['fx_persppush', 'Perspective Push'],
  ['fx_motionmatchblur', 'Motion Match Blur'],
  ['fx_signalline', 'Signal Line Cut'],
];
const W = 64, H = 36;
const solid = (r, g, b) => {
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
  return buf;
};
const A = solid(200, 30, 30); // outgoing: red
const B = solid(30, 30, 200); // incoming: blue
const run = (expr, p) => runTransition(A, B, new Uint8ClampedArray(A.length), W, H, p, expr);
const px = (buf, x, y) => [buf[(y * W + x) * 4], buf[(y * W + x) * 4 + 1], buf[(y * W + x) * 4 + 2]];
const meanDiff = (a, b) => {
  let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (W * H * 3);
};
const isRed = ([r, g, b]) => r > 150 && g < 80 && b < 80;
const isBlue = ([r, g, b]) => b > 150 && r < 80 && g < 80;

// 130 on the merged tree: 123 after CC-05, +1 Card Flip (gap-b), +6 gap-c.
assert.equal(TRANSITIONS.length, 130, 'transition catalogue totals 130');
for (const [id, name] of IDS) {
  const t = fxTransition(id);
  assert.ok(t, `${id} resolves in the FX registry`);
  assert.equal(t.name, name, `${id} is named ${name}`);
  assert.ok(TRANSITIONS.find((x) => x.id === id && x.fx === true), `${id} is an fx transition in TRANSITIONS`);
  assert.ok(t.duration > 0 && t.duration <= 2, `${id} default length`);
  parse(t.expr);
  assert.match(shaderSource(t.expr, 'transition'), /void main/, `${id} builds a shader`);
  const start = run(t.expr, 0), mid = run(t.expr, 0.5), end = run(t.expr, 1);
  assert.ok(meanDiff(start, A) < 0.5, `${id} starts exactly on A (diff ${meanDiff(start, A).toFixed(2)})`);
  assert.ok(meanDiff(end, B) < 0.5, `${id} ends exactly on B (diff ${meanDiff(end, B).toFixed(2)})`);
  assert.ok(meanDiff(mid, A) > 5 && meanDiff(mid, B) > 5, `${id} is a real motion at mid-cut`);
  console.log(`${id} ok (start ${meanDiff(start, A).toFixed(2)}, mid-vs-A ${meanDiff(mid, A).toFixed(1)}, end ${meanDiff(end, B).toFixed(2)})`);
}
// Direction: push up slides A up — at mid-cut the bottom rows are already B and
// the top rows are still A; push down is the mirror.
{
  const up = run(fxTransition('fx_pushsmoothup').expr, 0.5);
  assert.ok(isRed(px(up, 10, 4)), 'push up: top rows still A');
  assert.ok(isBlue(px(up, 10, H - 5)), 'push up: bottom rows already B');
  const down = run(fxTransition('fx_pushsmoothdown').expr, 0.5);
  assert.ok(isBlue(px(down, 10, 4)), 'push down: top rows already B');
  assert.ok(isRed(px(down, 10, H - 5)), 'push down: bottom rows still A');
  console.log('smooth push directions ok');
}
// Signal Line Cut: at mid-cut the frame is split along the sweep line (top B,
// bottom A) and the line itself is bright.
{
  const mid = run(fxTransition('fx_signalline').expr, 0.5);
  assert.ok(isBlue(px(mid, 10, 2)), 'signal line: above the line is B');
  assert.ok(isRed(px(mid, 10, H - 3)), 'signal line: below the line is A');
  const line = px(mid, 10, Math.floor(H * 0.5));
  assert.ok(line[0] + line[1] + line[2] > 600, `signal line: the sweep line is bright (${line})`);
  console.log('signal line cut ok');
}
// Motion Match Blur: mid-cut is not a plain crossfade — the directional blur
// spreads values away from the 50/50 blend.
{
  const mid = run(fxTransition('fx_motionmatchblur').expr, 0.5);
  const blend = new Uint8ClampedArray(A.length);
  for (let i = 0; i < A.length; i++) blend[i] = Math.round((A[i] + B[i]) / 2);
  // Solid colours blur into themselves, so use a taller split-frame pair for
  // this check (the blur length scales with frame height, like every engine blur).
  const W2 = 64, H2 = 180;
  const solid2 = (r, g, b) => {
    const buf = new Uint8ClampedArray(W2 * H2 * 4);
    for (let i = 0; i < W2 * H2; i++) { buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255; }
    return buf;
  };
  const As = solid2(200, 30, 30), Bs = solid2(30, 30, 200);
  for (let y = 0; y < H2; y++) for (let x = Math.floor(W2 / 2); x < W2; x++) { As[(y * W2 + x) * 4] = 30; As[(y * W2 + x) * 4 + 1] = 30; As[(y * W2 + x) * 4 + 2] = 30; Bs[(y * W2 + x) * 4] = 200; Bs[(y * W2 + x) * 4 + 1] = 200; Bs[(y * W2 + x) * 4 + 2] = 200; }
  const m2 = runTransition(As, Bs, new Uint8ClampedArray(As.length), W2, H2, 0.5, fxTransition('fx_motionmatchblur').expr);
  const bl2 = new Uint8ClampedArray(As.length);
  for (let i = 0; i < As.length; i++) bl2[i] = Math.round((As[i] + Bs[i]) / 2);
  const md = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (W2 * H2 * 3); };
  assert.ok(md(m2, bl2) > 1, `motion match blur spreads past a plain blend (diff ${md(m2, bl2).toFixed(2)})`);
  console.log('motion match blur ok');
}
// Collections surface all six as implemented (no adapted badge) and the smooth
// pushes share one direction group with left/right.
for (const [id] of IDS) {
  const item = COLLECTION_ITEMS.find((e) => e.engineId === id);
  assert.ok(item, `${id} appears in the collections`);
  assert.equal(item.status, 'implemented', `${id} is implemented, not adapted`);
}
assert.equal(directionGroupFor('fx_pushsmoothup').group.name, 'Smooth Push', 'push up joins the Smooth Push group');
assert.equal(directionGroupFor('fx_pushsmoothup').dir, 'up', 'push up direction is up');
assert.equal(directionGroupFor('fx_pushsmoothdown').dir, 'down', 'push down direction is down');
console.log('gapc-transitions ok');
