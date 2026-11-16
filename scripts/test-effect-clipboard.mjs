// Effect clipboard acceptance test (FB-27 · P1-42).
// Run: node scripts/test-effect-clipboard.mjs
import assert from 'assert/strict';
import { copyEffectsFromClip, getEffectClipboard, pasteEffectsPatch, pasteEffectsUpdates } from '../src/fx/effectClipboard.js';

// localStorage shim for node (the module persists the clipboard there).
globalThis.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = String(v); },
  removeItem(k) { delete this._v[k]; },
};

const clip = (len, over = {}) => ({ id: 'c1', in: 0, out: len, ...over });
const src = clip(6, {
  effects: ['grain', 'blur'],
  fxStrength: { grain: 0.5 },
  fxTiming: { grain: { start: 1, duration: 2 } },
  fxParams: { grain: { amount: 10 } },
  fxRegions: { blur: { x: 0.3, y: 0.3, w: 0.4, h: 0.4, feather: 0.05, shape: 'rect', invert: false } },
  fxKeys: { grain: [{ t: 1.5, v: 0.2 }, { t: 6, v: 0.9 }] },
  fxBypass: { blur: true },
  fxSolo: { grain: true },
});
const snap = copyEffectsFromClip(src);
assert.equal(snap.sourceLen, 6);
assert.equal(snap.effects.length, 2);
assert.deepEqual(getEffectClipboard(), snap, 'clipboard round-trips through storage');
// Paste onto a 3 s clip: keyframes and windows land at the same RELATIVE positions.
{
  const p = pasteEffectsPatch(clip(3), snap);
  assert.deepEqual(p.effects, ['grain', 'blur']);
  assert.equal(p.fxStrength.grain, 0.5, 'strength copies verbatim');
  assert.deepEqual(p.fxTiming.grain, { start: 0.5, duration: 1 }, 'timing window scales by 1/2');
  assert.deepEqual(p.fxParams.grain, { amount: 10 }, 'params copy verbatim');
  assert.deepEqual(p.fxRegions.blur, src.fxRegions.blur, 'region copies verbatim');
  assert.deepEqual(p.fxKeys.grain, [{ t: 0.75, v: 0.2 }, { t: 3, v: 0.9 }], 'keyframes scale to relative positions');
  assert.equal(p.fxBypass.blur, true, 'bypass copies');
  assert.equal(p.fxSolo, undefined, 'solo is NOT copied');
}
// Paste onto a 12 s clip: keys scale up.
{
  const p = pasteEffectsPatch(clip(12), snap);
  assert.deepEqual(p.fxKeys.grain, [{ t: 3, v: 0.2 }, { t: 12, v: 0.9 }]);
  assert.deepEqual(p.fxTiming.grain, { start: 2, duration: 4 });
}
// Existing effects on the target keep their place; a pasted duplicate takes the copied state.
{
  const target = clip(6, { effects: ['mirror'], fxStrength: { mirror: 0.7 } });
  const p = pasteEffectsPatch(target, snap);
  assert.deepEqual(p.effects, ['mirror', 'grain', 'blur'], 'pasted effects append after existing');
  assert.equal(p.fxStrength.mirror, 0.7, 'untouched effects keep their values');
  const again = pasteEffectsPatch({ ...target, effects: p.effects, fxStrength: p.fxStrength }, snap);
  assert.deepEqual(again.effects, ['mirror', 'grain', 'blur'], 're-paste does not duplicate');
  assert.equal(again.fxStrength.grain, 0.5, 're-paste refreshes the copied state');
}
// Multi-clip paste: one update per clip, each with its own relativized patch.
{
  const items = [{ track: 'video', clip: clip(3) }, { track: 'overlay', clip: clip(12) }];
  const updates = pasteEffectsUpdates(items, snap);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].track, 'video');
  assert.equal(updates[1].track, 'overlay');
  assert.deepEqual(updates[0].patch.fxKeys.grain, [{ t: 0.75, v: 0.2 }, { t: 3, v: 0.9 }]);
  assert.deepEqual(updates[1].patch.fxKeys.grain, [{ t: 3, v: 0.2 }, { t: 12, v: 0.9 }]);
  assert.deepEqual(pasteEffectsUpdates(items, null), [], 'empty clipboard pastes nothing');
  assert.deepEqual(pasteEffectsPatch(clip(3), null), {}, 'empty snapshot is a no-op patch');
}
console.log('effect-clipboard OK: copy/paste with relative keyframes, multi-clip updates, solo not copied');
