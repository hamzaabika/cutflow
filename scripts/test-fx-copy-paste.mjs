// FX-02 — multi-select effect copy/paste with relative keyframes: a clip's
// whole effect stack (ids, params, strengths, intensity keys, timing
// windows) copies from one or several source clips and pastes onto every
// target clip; keyframe times and timing windows scale by the target's
// local span, so the shape survives a different clip length.
// Usage: node scripts/test-fx-copy-paste.mjs
import assert from 'node:assert/strict';
import { copyEffectsStack, pasteEffectsStack, copyEffects, pasteEffects, getEffectsClipboard, clipSpan } from '../src/fx/effectClipboard.js';

const src = {
  id: 'a', duration: 4, in: 0, out: 4, speed: 1,
  effects: ['fx_blur', 'fx_vignette'],
  fxParams: { fx_blur: { amount: 0.5 }, fx_vignette: { amount: 0.6 } },
  fxStrength: { fx_blur: 0.8 },
  fxKeys: { fx_blur: [{ t: 1, v: 0 }, { t: 3, v: 1 }] },
  fxTiming: { fx_vignette: { start: 0.5, duration: 2 } },
  fxRegions: { fx_blur: { x: 0, y: 0, w: 1, h: 1 } },
};

// Copy captures the whole stack with its source span.
const stack = copyEffectsStack(src);
assert.ok(stack, 'a clip with effects copies');
assert.equal(stack.span, 4, 'the source span travels with the stack');
assert.deepEqual(stack.effects, ['fx_blur', 'fx_vignette'], 'effect order is kept');
assert.equal(copyEffectsStack({ id: 'x', duration: 2, effects: [] }), null, 'a clip with no effects copies to null');

// Paste onto a same-length clip is identity for times.
const same = { id: 'b', duration: 4, in: 0, out: 4, speed: 1, effects: [] };
const p1 = pasteEffectsStack(same, stack, 'replace');
assert.deepEqual(p1.effects, ['fx_blur', 'fx_vignette'], 'replace swaps the stack');
assert.deepEqual(p1.fxKeys.fx_blur, [{ t: 1, v: 0 }, { t: 3, v: 1 }], 'same-span paste keeps keyframe times');
assert.deepEqual(p1.fxTiming.fx_vignette, { start: 0.5, duration: 2 }, 'same-span paste keeps the timing window');
assert.equal(p1.fxParams.fx_blur.amount, 0.5, 'params travel');
assert.equal(p1.fxStrength.fx_blur, 0.8, 'strengths travel');

// Paste onto a half-length clip scales times by 1/2 (relative keyframes).
const half = { id: 'c', duration: 2, in: 0, out: 2, speed: 1, effects: [] };
const p2 = pasteEffectsStack(half, stack, 'replace');
assert.deepEqual(p2.fxKeys.fx_blur, [{ t: 0.5, v: 0 }, { t: 1.5, v: 1 }], 'half-span paste halves keyframe times');
assert.deepEqual(p2.fxTiming.fx_vignette, { start: 0.25, duration: 1 }, 'half-span paste halves the timing window');

// Merge keeps the target's own effects and overwrites the copied id's data.
const target = { id: 'd', duration: 4, in: 0, out: 4, speed: 1, effects: ['fx_grain'], fxParams: { fx_grain: { amount: 0.2 } }, fxStrength: { fx_grain: 0.5 } };
const p3 = pasteEffectsStack(target, stack, 'merge');
assert.deepEqual(p3.effects, ['fx_grain', 'fx_blur', 'fx_vignette'], 'merge appends the copied effects after the target’s own');
assert.equal(p3.fxParams.fx_grain.amount, 0.2, 'merge keeps the target’s own params');
assert.equal(p3.fxParams.fx_blur.amount, 0.5, 'merge adds the copied params');

// Pasting the same stack twice is a no-op (no phantom undo step).
assert.equal(pasteEffectsStack({ ...same, ...p1 }, stack, 'merge'), null, 're-pasting the same stack changes nothing');

// Multi-select: two sources round-robin across three targets.
copyEffects([src, { id: 'e', duration: 4, in: 0, out: 4, speed: 1, effects: ['fx_grain'], fxParams: { fx_grain: { amount: 0.9 } } }]);
assert.equal(getEffectsClipboard().stacks.length, 2, 'two source stacks on the clipboard');
const targets = [
  { track: 'video', clip: { id: 't1', duration: 4, in: 0, out: 4, speed: 1, effects: [] } },
  { track: 'video', clip: { id: 't2', duration: 4, in: 0, out: 4, speed: 1, effects: [] } },
  { track: 'video', clip: { id: 't3', duration: 4, in: 0, out: 4, speed: 1, effects: [] } },
];
const updates = pasteEffects(targets);
assert.equal(updates.length, 3, 'one patch per target');
assert.deepEqual(updates[0].patch.effects, ['fx_blur', 'fx_vignette'], 'target 1 gets stack A');
assert.deepEqual(updates[1].patch.effects, ['fx_grain'], 'target 2 gets stack B');
assert.deepEqual(updates[2].patch.effects, ['fx_blur', 'fx_vignette'], 'target 3 round-robins back to stack A');
assert.equal(updates[0].track, 'video', 'patches carry their track for updateMany');

// Empty clipboard pastes nothing.
assert.deepEqual(pasteEffects(targets, { version: 1, stacks: [] }), [], 'an empty clipboard pastes nothing');
assert.deepEqual(pasteEffects(targets, null), [], 'a null clipboard pastes nothing');

console.log('fx-copy-paste: all checks passed');
