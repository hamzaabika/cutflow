// Physics-based motion (P3-06), pure-node suite: the spring and gravity
// solvers in fx/easing.js, their keyframe integration, the jelly wobble
// deformation, and the physics text animations. The live behaviour (curve
// editor chips, preview dot overshoot, preview/export frame parity) is
// covered by test-p3b-live.mjs.
// Usage: node scripts/test-physics-motion.mjs
import assert from 'node:assert/strict';
import { EASE_PRESETS, PHYSICS_EASES, easeValue, easeName, isPhysicsEase, physicsIdOf, physicsParamsOf, physicsDefaults, springPhysicsValue, gravityBounceValue } from '../src/fx/easing.js';
import { stateAt, motionCurves } from '../src/anim.js';
import { runEffect } from '../src/fx/run.js';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';
import { ANIM_IN } from '../src/text/catalog.js';
import { TEXT_ANIMS_IN } from '../src/fx/textAnim.js';
import fs from 'node:fs';

const sample = (fn, n = 101) => Array.from({ length: n }, (_, i) => fn(i / (n - 1)));

// ---- Registry: physics easings are distinct from the bezier spring/bounce ----
assert.deepEqual(PHYSICS_EASES.map((p) => p.id), ['springPhysics', 'gravityBounce'], 'two physics easings');
assert.ok(!EASE_PRESETS.some((p) => p.id === 'springPhysics' || p.id === 'gravityBounce'), 'physics easings are not bezier presets');
assert.equal(easeName('springPhysics'), 'Spring', 'spring physics name');
assert.equal(easeName('gravityBounce'), 'Gravity Bounce', 'gravity bounce name');
assert.ok(isPhysicsEase('springPhysics') && isPhysicsEase({ physics: 'bounce', gravity: 20 }));
assert.ok(!isPhysicsEase('spring') && !isPhysicsEase({ p1x: 0.2, p1y: 0.9, p2x: 0.3, p2y: 0.1 }), 'bezier spring/custom are not physics');
assert.equal(physicsIdOf({ physics: 'spring', stiffness: 300 }), 'springPhysics', 'object form resolves');
assert.deepEqual(physicsDefaults('springPhysics'), { stiffness: 170, damping: 12, mass: 1 }, 'spring defaults');
assert.deepEqual(physicsParamsOf({ physics: 'bounce', restitution: 0.7 }), { gravity: 10, restitution: 0.7 }, 'params merge over defaults');

// ---- Spring: endpoints exact, overshoots and settles, parameters matter ----
const spr = sample((t) => easeValue('springPhysics', t));
assert.strictEqual(spr[0], 0, 'spring starts at 0');
assert.strictEqual(spr[100], 1, 'spring ends exactly at 1');
assert.ok(Math.max(...spr) > 1.05, `spring overshoots (max ${Math.max(...spr).toFixed(3)})`);
const sprPeak = spr.indexOf(Math.max(...spr));
assert.ok(sprPeak > 0 && sprPeak < 50, `spring peaks early, then settles (peak at t=${(sprPeak / 100).toFixed(2)})`);
assert.ok(Math.min(...spr.slice(sprPeak)) < 1 && Math.min(...spr.slice(sprPeak)) > 0.9, 'spring undershoots after the peak, then settles');
const sprTrough = sprPeak + spr.slice(sprPeak).indexOf(Math.min(...spr.slice(sprPeak)));
assert.ok(spr[80] > spr[sprTrough], 'spring recovers from the trough toward 1');
// Low damping oscillates more than high damping.
const loose = sample((t) => springPhysicsValue(t, { stiffness: 170, damping: 2, mass: 1 }));
const damped = sample((t) => springPhysicsValue(t, { stiffness: 170, damping: 20, mass: 1 }));
const over = sample((t) => springPhysicsValue(t, { stiffness: 170, damping: 30, mass: 1 }));
const crossings = (arr) => { let c = 0; for (let i = 1; i < arr.length; i++) if ((arr[i - 1] - 1) * (arr[i] - 1) < 0) c++; return c; };
assert.ok(crossings(loose) > crossings(damped), `low damping oscillates more (${crossings(loose)} vs ${crossings(damped)} crossings)`);
assert.ok(Math.max(...damped) < Math.max(...loose), 'high damping overshoots less');
assert.ok(Math.max(...damped) > 1 && Math.max(...damped) < 1.05, 'a damped (underdamped) spring still overshoots a little');
assert.ok(Math.max(...over) <= 1.000001, 'an overdamped spring never overshoots');
// Higher stiffness peaks earlier; higher mass peaks later.
const peakAt = (arr) => arr.indexOf(Math.max(...arr));
assert.ok(peakAt(sample((t) => springPhysicsValue(t, { stiffness: 400, damping: 12, mass: 1 })))
  < peakAt(sample((t) => springPhysicsValue(t, { stiffness: 60, damping: 12, mass: 1 }))), 'stiffer spring peaks earlier');
assert.ok(peakAt(sample((t) => springPhysicsValue(t, { stiffness: 170, damping: 12, mass: 3 })))
  > peakAt(sample((t) => springPhysicsValue(t, { stiffness: 170, damping: 12, mass: 0.5 }))), 'heavier mass peaks later');
// Object form equals the string form at defaults; custom params change the curve.
for (const t of [0.1, 0.3, 0.6, 0.9]) {
  assert.ok(Math.abs(easeValue({ physics: 'spring' }, t) - easeValue('springPhysics', t)) < 1e-12, 'spring object form = preset at defaults');
}
assert.ok(Math.abs(easeValue({ physics: 'spring', stiffness: 400 }, 0.3) - easeValue('springPhysics', 0.3)) > 0.01, 'stiffness param changes the curve');

// ---- Gravity bounce: endpoints exact, falls, impacts, rebounds, lands ----
const bnc = sample((t) => easeValue('gravityBounce', t));
assert.strictEqual(bnc[0], 0, 'bounce starts at 0');
assert.strictEqual(bnc[100], 1, 'bounce ends exactly at 1');
assert.ok(Math.min(...bnc) >= 0 && Math.max(...bnc) <= 1, 'bounce stays in [0, 1]');
assert.ok(bnc[25] > 0.2 && bnc[25] < 0.6, `bounce falls fast early (${bnc[25].toFixed(3)} at t=0.25)`);
// Non-monotonic: the first rebound dips back after the first impact.
let dipped = false;
for (let i = 1; i < bnc.length; i++) if (bnc[i] < bnc[i - 1] - 0.01) { dipped = true; break; }
assert.ok(dipped, 'bounce dips back on rebound');
const firstPeak = bnc.indexOf(Math.max(...bnc.slice(0, 60)));
assert.ok(firstPeak > 0 && bnc[firstPeak] > 0.85, `first impact nearly lands (${bnc[firstPeak].toFixed(3)})`);
// Restitution 0 is a pure drop (monotonic); higher restitution bounces higher.
const drop = sample((t) => gravityBounceValue(t, { gravity: 10, restitution: 0 }));
assert.ok(drop.every((v, i) => i === 0 || v >= drop[i - 1] - 1e-12), 'restitution 0 never dips');
const bouncy = sample((t) => gravityBounceValue(t, { gravity: 10, restitution: 0.8 }));
assert.ok(Math.max(...bouncy.slice(50, 80)) - Math.min(...bouncy.slice(50, 80)) > 0.05, 'high restitution keeps bouncing late');
assert.ok(Math.abs(easeValue({ physics: 'bounce' }, 0.4) - easeValue('gravityBounce', 0.4)) < 1e-12, 'bounce object form = preset at defaults');

// ---- Keyframes: a physics ease bends a segment, overshoots, ends exact ----
const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };
const seg = (e) => ({ ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 3, ...(e ? { e } : {}) }] } });
const midScale = (e) => stateAt(seg(e), 1, 4).transform.scale;
const segMax = (e) => Math.max(...Array.from({ length: 21 }, (_, i) => stateAt(seg(e), i * 0.1, 4).transform.scale));
assert.ok(segMax('springPhysics') > 3.05, `spring keyframe overshoots the target during the segment (max ${segMax('springPhysics').toFixed(3)})`);
assert.strictEqual(stateAt(seg('springPhysics'), 2, 4).transform.scale, 3, 'spring keyframe ends exactly on the target');
assert.ok(midScale('gravityBounce') > 1 && midScale('gravityBounce') < 3, 'bounce keyframe travels mid-segment');
const curve = motionCurves(seg('springPhysics'), 2, 30).s;
assert.ok(Math.max(...curve.map((p) => p[1])) > 3, 'export curve follows the spring overshoot');
const objEase = { physics: 'spring', stiffness: 400, damping: 8, mass: 1 };
assert.ok(Math.abs(stateAt(seg(objEase), 1, 4).transform.scale - (1 + 2 * springPhysicsValue(0.5, objEase))) < 1e-9, 'physics object on a keyframe');

// ---- Jelly wobble: a real parametric deformation ----
const jelly = PIXEL_EFFECTS.find((e) => e.id === 'fx_jelly');
assert.ok(jelly, 'fx_jelly resolves in the pixel catalogue');
assert.deepEqual(jelly.params.map((p) => p.key), ['amount', 'waves', 'settle'], 'jelly params');
const W = 64; const H = 36;
const src = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; src[i] = (x * 255) / W; src[i + 1] = (y * 255) / H; src[i + 2] = 128; src[i + 3] = 255; }
const diffAt = (T, expr) => {
  const out = new Uint8Array(W * H * 4);
  runEffect(src, out, W, H, T, expr);
  let s = 0; for (let i = 0; i < src.length; i += 4) s += Math.abs(out[i] - src[i]) + Math.abs(out[i + 1] - src[i + 1]);
  return s / (W * H) / 2;
};
const d0 = diffAt(0, jelly.expr);
const d05 = diffAt(0.5, jelly.expr);
const dLate = diffAt(10, jelly.expr);
assert.ok(d0 > 1 && d05 > 1, `jelly deforms the frame early (diff ${d0.toFixed(2)} @0s, ${d05.toFixed(2)} @0.5s)`);
assert.ok(dLate < 0.05, `jelly settles by 10 s (diff ${dLate.toFixed(3)})`);
// Settle 0 is an endless wobble: still deforming late.
const endless = jelly.make({ amount: 0.008, waves: 2, settle: 0 });
assert.ok(diffAt(10, endless) > 1, 'settle 0 keeps wobbling');
const outA = new Uint8Array(W * H * 4); const outB = new Uint8Array(W * H * 4);
// High-contrast checker source: a 1 px shift moves values by ~170, so the
// param's effect is visible under the engine's trunc sampling.
const chk = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const v = (((x >> 2) + (y >> 2)) % 2) * 200 + 30; chk[i] = v; chk[i + 1] = v; chk[i + 2] = v; chk[i + 3] = 255; }
runEffect(chk, outA, W, H, 0, jelly.expr);
runEffect(chk, outB, W, H, 0, jelly.make({ amount: 0.03, waves: 2, settle: 1.2 }));
let abDiff = 0; for (let i = 0; i < chk.length; i += 4) abDiff += Math.abs(outA[i] - outB[i]);
assert.ok(abDiff / (W * H) > 0.5, 'amount param changes the deformation');

// ---- Physics text animations are registered and implemented ----
const renderSrc = fs.readFileSync(new URL('../src/text/render.js', import.meta.url), 'utf8');
const animStateSrc = renderSrc.slice(renderSrc.indexOf('function animState'), renderSrc.indexOf('function loopState'));
for (const anim of ['springSettle', 'gravityDrop']) {
  assert.ok(ANIM_IN.some((a) => a.id === anim), `${anim} registered in ANIM_IN`);
  assert.ok(TEXT_ANIMS_IN.some((p) => p.anim === anim), `${anim} has a text preset`);
  assert.ok(animStateSrc.includes(`case '${anim}'`), `${anim} implemented in the text renderer`);
}

console.log(`physics-motion OK — spring overshoot ${Math.max(...spr).toFixed(3)}, bounce dips and lands, jelly ${d0.toFixed(2)} -> ${dLate.toFixed(3)}, keyframes + text registered`);
