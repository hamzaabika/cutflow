// Effect-stack controls acceptance test (FB-26 · P1-41).
// Run: node scripts/test-effect-stack.mjs
import assert from 'assert/strict';
import { clipFxVisible, compareOnPatch, moveEffect, resetEffectPatch, toggleFxFlag, visibleClipEffects } from '../src/fx/effectStack.js';
import { clipHasPixelFx, pixelPasses } from '../src/fx/apply.js';

const clip = (over = {}) => ({ id: 'c1', in: 0, out: 6, effects: ['mirror', 'grain', 'blur'], ...over });

// Reorder: the array order is the render order.
assert.deepEqual(moveEffect(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
assert.deepEqual(moveEffect(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
assert.deepEqual(moveEffect(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'top stays');
assert.deepEqual(moveEffect(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'], 'bottom stays');
assert.deepEqual(moveEffect(['a', 'b'], 'x', 1), ['a', 'b'], 'missing id is a no-op');
// Solo / bypass visibility.
assert.ok(clipFxVisible(clip(), 'mirror'), 'no flags: visible');
assert.ok(!clipFxVisible(clip({ fxBypass: { grain: true } }), 'grain'), 'bypassed hides');
assert.ok(clipFxVisible(clip({ fxBypass: { grain: true } }), 'mirror'), 'other effects stay visible');
assert.ok(clipFxVisible(clip({ fxSolo: { blur: true } }), 'blur'), 'soloed shows');
assert.ok(!clipFxVisible(clip({ fxSolo: { blur: true } }), 'mirror'), 'non-soloed hides when any solo is on');
assert.ok(clipFxVisible(clip({ fxSolo: { blur: true }, fxBypass: { blur: true } }), 'blur'), 'solo wins over bypass on the same effect');
assert.deepEqual(visibleClipEffects(clip({ fxBypass: { grain: true } })), ['mirror', 'blur']);
// Flag toggling stays sparse.
assert.deepEqual(toggleFxFlag(undefined, 'grain'), { grain: true });
assert.equal(toggleFxFlag({ grain: true }, 'grain'), undefined, 'emptied map disappears');
// Reset per effect: only that effect's entries go.
{
  const c = clip({ fxStrength: { grain: 0.5, blur: 0.8 }, fxParams: { grain: { amount: 10 } }, fxBypass: { grain: true }, fxSolo: { blur: true } });
  const p = resetEffectPatch(c, 'grain');
  assert.equal(p.fxStrength.grain, undefined);
  assert.equal(p.fxStrength.blur, 0.8, 'other effects untouched');
  assert.equal(p.fxParams, undefined, 'emptied map disappears');
  assert.equal(p.fxBypass, undefined);
  assert.equal(p.fxSolo, undefined, 'solo map untouched by another effect reset (absent from patch)');
  assert.deepEqual(resetEffectPatch(clip(), 'grain'), {}, 'nothing stored: empty patch');
}
// Compare: bypasses everything, restorable from the previous map.
assert.deepEqual(compareOnPatch(clip()).fxBypass, { mirror: true, grain: true, blur: true });
// Engine: preview and export share pixelPasses, so bypass/solo/order land in both.
// mirror and grain are classics with real expressions; blur is a classic too.
const project = (c) => ({ videoClips: [c], overlayClips: [], effectClips: [], media: [] });
const exprs = (c) => pixelPasses(project(c), c, 0, 1).map((p) => p.expr || `lut:${p.lut ? 'yes' : 'no'}`);
{
  const base = exprs(clip());
  assert.equal(base.length, 3, `three effects render three passes (got ${base.length})`);
  const bypassed = exprs(clip({ fxBypass: { grain: true } }));
  assert.equal(bypassed.length, 2, 'bypassed grain renders no pass');
  assert.ok(!bypassed.some((e) => e.includes('hash(X*1.37')), 'grain expression is gone');
  const soloed = exprs(clip({ fxSolo: { blur: true } }));
  assert.equal(soloed.length, 1, 'solo renders only the soloed effect');
  const reordered = exprs(clip({ effects: ['blur', 'grain', 'mirror'] }));
  assert.notDeepEqual(reordered, base, 'reordering changes pass order');
  assert.equal(reordered[0], base[2], 'blur moves to the front');
  assert.ok(clipHasPixelFx(project(clip()), clip(), 0, 6), 'clip with effects needs the fx pass');
  assert.ok(!clipHasPixelFx(project(clip({ fxBypass: { mirror: true, grain: true, blur: true } })), clip({ fxBypass: { mirror: true, grain: true, blur: true } }), 0, 6), 'all bypassed: no fx pass needed');
}
console.log('effect-stack OK: reorder/solo/bypass/reset/compare, preview and export share the same pass order');
