// Inspector effect management (R3, parity-matrix §9): a clip's bound effects are
// fully managed from the clip inspector — strength, region and removal — through
// the SAME dispatches the Effects-lane selection used (BoundFxCards in
// src/components/FxControls.jsx, shared by both surfaces). This suite pins the
// data path those writes take and that both render paths reflect them:
// pixelPasses is the single pass builder for preview and export alike.
// Usage: node scripts/test-inspector-fx.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject } from '../src/store.js';
import { pixelPasses } from '../src/fx/apply.js';
import { PIXEL_EFFECTS } from '../src/fx/catalog.js';

const PIX = PIXEL_EFFECTS[0].id; // a shader (pixel) effect
const mkClip = (patch = {}) => ({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: [PIX, 'blur'], ...patch });
const fresh = (clip) => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'm', type: 'video', duration: 20 }],
    videoClips: [clip],
    overlayClips: [],
    effectClips: [],
    textClips: [],
    audioClips: [],
  },
  future: [],
});
const run = (st, ...actions) => actions.reduce(historyReducer, st);
const host = (st) => st.present.videoClips[0];
const passes = (st, lt = 1.5) => pixelPasses(st.present, host(st), 0, lt);

// The exact write shapes BoundFxCards performs (its setStrength / setRegion).
const writeStrength = (clip, fx, k) => {
  const next = { ...(clip.fxStrength || {}) };
  if (k >= 1) delete next[fx]; else next[fx] = k;
  return { type: 'update', track: 'video', id: clip.id, patch: { fxStrength: next } };
};
const writeRegion = (clip, fx, region) => ({
  type: 'update', track: 'video', id: clip.id,
  patch: { fxRegions: { ...(clip.fxRegions || {}), [fx]: region } },
});
const REGION = { shape: 'rect', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0.02, invert: false };

// --- Baseline: both effects render at full strength, unregioned ---
let st = fresh(mkClip());
assert.equal(passes(st).length, 2, 'both bound effects produce a pass');
const fullExpr = passes(st)[0].expr;
const blurExpr = passes(st)[1].expr;

// --- Strength from the inspector: the pass's mix changes, the other effect is untouched ---
st = run(st, writeStrength(host(st), PIX, 0.5));
assert.deepEqual(host(st).fxStrength, { [PIX]: 0.5 }, 'the strength lands on the clip');
assert.equal(passes(st).length, 2, 'a half-strength effect still renders');
assert.notEqual(passes(st)[0].expr, fullExpr, 'the shader mix reflects the new strength (preview + export share pixelPasses)');

// --- Strength 0 removes the pass; the effect itself stays on the clip ---
st = run(st, writeStrength(host(st), PIX, 0));
assert.deepEqual(host(st).effects, [PIX, 'blur'], 'strength 0 does not remove the effect');
assert.equal(passes(st).length, 1, 'strength 0 removes the pass entirely');

// --- Back to full strength: the map entry is deleted, not stored as 1 ---
st = run(st, writeStrength(host(st), PIX, 1));
assert.deepEqual(host(st).fxStrength, {}, 'full strength is stored as no entry');
assert.equal(passes(st)[0].expr, fullExpr, 'the pass is the authored effect again');

// --- A strength write is one undo step (a plain update, like every inspector field) ---
st = run(st, writeStrength(host(st), PIX, 0.25));
st = run(st, { type: 'undo' });
assert.deepEqual(host(st).fxStrength, {}, 'one undo reverts the strength change');

// --- Region from the inspector: the pass is wrapped to the region ---
st = run(st, writeRegion(host(st), PIX, REGION));
assert.deepEqual(host(st).fxRegions, { [PIX]: REGION }, 'the region lands on the clip');
assert.notEqual(passes(st)[0].expr, fullExpr, 'the shader is region-wrapped after the write');

// --- Removal from the inspector: the FxEntry dispatches removeEffect with the bound key ---
st = run(st, { type: 'removeEffect', id: `video|a|${PIX}` });
assert.deepEqual(host(st).effects, ['blur'], 'the effect is removed from the clip');
assert.deepEqual(host(st).fxRegions, {}, 'its region goes with it');
assert.equal(passes(st).length, 1, 'only the remaining effect renders');
assert.equal(passes(st)[0].expr, blurExpr, 'the surviving pass is the other effect, unchanged');

console.log('INSPECTOR-FX OK');
