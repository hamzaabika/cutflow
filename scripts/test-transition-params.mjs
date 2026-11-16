// Parametric transition controls acceptance test (FB-11 · P1-08).
// Run: node scripts/test-transition-params.mjs
import assert from 'assert/strict';
import { GENERIC_TR_SCHEMA, trCapabilities, trGenericDefaults, trSchema, trDefaults, mergeTrParams, transitionExpr } from '../src/fx/params.js';
import { transitionStrengthAt } from '../src/fx/morph.js';
import { TRANSITIONS } from '../src/effects.js';

// The generic schema names all seven keys…
const keys = GENERIC_TR_SCHEMA.map((p) => p.key);
for (const k of ['duration', 'direction', 'ease', 'strength', 'center', 'softness', 'motionBlur']) {
  assert.ok(keys.includes(k), `generic schema has ${k}`);
}
// …but capabilities never expose motionBlur (no wiring) or center as its own
// control (it is the mask-reveal direction option).
for (const t of TRANSITIONS) {
  const caps = trCapabilities(t.id).map((c) => c.key);
  assert.ok(!caps.includes('motionBlur'), `${t.id} must never expose motionBlur`);
  assert.ok(!caps.includes('center'), `${t.id} must never expose center separately`);
  assert.ok(caps.includes('duration'), `${t.id} always offers duration`);
  assert.ok(new Set(caps).size === caps.length, `${t.id} capabilities are unique`);
}
// Top families first: the wipe family gets direction + softness…
for (const id of ['fx_gradientwipe', 'fx_lumawipe', 'fx_maskreveal']) {
  const caps = trCapabilities(id).map((c) => c.key);
  assert.ok(caps.includes('softness'), `${id} offers softness`);
}
assert.ok(trCapabilities('fx_gradientwipe').map((c) => c.key).includes('direction'), 'gradient wipe offers direction');
assert.ok(trCapabilities('fx_maskreveal').map((c) => c.key).includes('direction'), 'mask reveal offers direction');
// …morph gets keyframe-aware strength, dissolve gets nothing irrelevant.
assert.ok(trCapabilities('fx_morphcut').map((c) => c.key).includes('strength'), 'morph offers strength');
assert.deepEqual(trCapabilities('dissolve').map((c) => c.key).sort(), ['duration', 'ease'], 'dissolve offers only duration + ease');
assert.deepEqual(trCapabilities('fade').map((c) => c.key), ['duration'], 'native fade offers only duration');
// Ease is an fx-transition capability only.
assert.ok(trCapabilities('fx_zoomin').map((c) => c.key).includes('ease'), 'fx zoom offers ease');
assert.ok(!trCapabilities('wipeleft').map((c) => c.key).includes('ease'), 'native wipe offers no ease');
// Generic defaults resolve from the schema; unknown ids fall back safely.
assert.deepEqual(trGenericDefaults('fx_gradientwipe'), { direction: 'from-left', softness: 0.08 });
assert.deepEqual(trGenericDefaults('dissolve'), {});
assert.deepEqual(trCapabilities('no-such-transition').map((c) => c.key), ['duration']);
// Existing wipe-family behaviour is untouched (additive-only change).
// B-F05's generic strength rides in the defaults/merge as a stored-only
// slot (pruned away at defaults) — the wipe expression never reads it.
assert.deepEqual(trDefaults('fx_gradientwipe'), { direction: 'from-left', feather: 0.08, strength: 1 });
assert.deepEqual(mergeTrParams('fx_gradientwipe', { feather: 0.5 }), { direction: 'from-left', feather: 0.3, strength: 1 }, 'feather still clamps');
assert.ok(typeof transitionExpr({ type: 'fx_gradientwipe' }) === 'string', 'wipe expression still resolves');
// Morph strength keyframes: static base, interpolated keys, hold outside.
const base = { type: 'fx_morphcut', duration: 0.8, params: { strength: 1 } };
assert.equal(transitionStrengthAt(base, 0), 1, 'no keys = static strength');
assert.equal(transitionStrengthAt(base, 0.5), 1);
const keyed = { ...base, strengthKeys: [{ t: 0, v: 0 }, { t: 0.8, v: 1 }] };
assert.ok(Math.abs(transitionStrengthAt(keyed, 0.5) - 0.5) < 1e-9, 'mid-transition strength interpolates to 0.5');
assert.equal(transitionStrengthAt(keyed, 0), 0, 'first key holds at start');
assert.equal(transitionStrengthAt(keyed, 1), 1, 'last key holds at end');
const baseHalf = { ...base, params: { strength: 0.5 } };
assert.equal(transitionStrengthAt({ ...baseHalf, strengthKeys: [{ t: 0.4, v: 1 }] }, 0), 1, 'before first key holds the key value');
console.log('transition-params OK: generic schema gated per transition, motionBlur never exposed, morph strength keyframes interpolate');
