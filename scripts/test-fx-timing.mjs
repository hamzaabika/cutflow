// Bound-effect timing: an effect attached to a clip can be trimmed to a window of the
// clip (clip.fxTiming), from the Effects lane's edge handles or the inspector. Covers the
// data path those gestures write — store model, lane objects, undo gesture semantics —
// and both render paths' gating (shader passes, overlay layers and their export ranges).
// Usage: node scripts/test-fx-timing.mjs
import assert from 'node:assert/strict';
import { effectObjects, fxTimingOf, historyReducer, normalizeProject, withFxTiming } from '../src/store.js';
import { classicViaShader, drawOverlayPasses, overlayRanges, pixelPasses } from '../src/fx/apply.js';
import { OVERLAY_EFFECTS, PIXEL_EFFECTS } from '../src/fx/catalog.js';

const PIX = PIXEL_EFFECTS[0].id; // a shader (pixel) effect
const SNOW = OVERLAY_EFFECTS[0].id; // a particle (overlay) effect
const mkClip = (patch = {}) => ({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: ['blur', PIX], ...patch });
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
const obj = (p, fx) => effectObjects(p).find((o) => o.key === `video|a|${fx}`);

// --- The lane object: untimed spans the clip, timed spans the window, clamped to the span ---
let st = fresh(mkClip());
assert.deepEqual([obj(st.present, 'blur').start, obj(st.present, 'blur').duration], [0, 6], 'untimed bound effect spans the whole clip');
st = run(st, { type: 'update', track: 'video', id: 'a', patch: { fxTiming: { blur: { start: 2, duration: 2 } } } });
assert.deepEqual([obj(st.present, 'blur').start, obj(st.present, 'blur').duration], [2, 2], 'timed bound effect spans its window');
assert.deepEqual([obj(st.present, PIX).start, obj(st.present, PIX).duration], [0, 6], 'the clip’s other effect is untouched');
st = run(st, { type: 'update', track: 'video', id: 'a', patch: { fxTiming: { blur: { start: 5, duration: 4 } } } });
assert.deepEqual([obj(st.present, 'blur').start, obj(st.present, 'blur').duration], [5, 1], 'a window past the clip end is clamped to the span');

// --- The drag's write path: withFxTiming patches inside one gesture = one undo step ---
st = fresh(mkClip());
const host = () => st.present.videoClips[0];
st = run(st, { type: 'beginGesture' },
  { type: 'update', track: 'video', id: 'a', patch: { fxTiming: withFxTiming(host(), 'blur', { start: 2, duration: 2 }, 6) } },
  { type: 'update', track: 'video', id: 'a', patch: { fxTiming: withFxTiming(host(), 'blur', { start: 2.5, duration: 2 }, 6) } },
  { type: 'endGesture' });
assert.deepEqual(host().fxTiming.blur, { start: 2.5, duration: 2 }, 'the drag lands the final window');
st = run(st, { type: 'undo' });
assert.equal(host().fxTiming, undefined, 'one undo reverts the whole trim gesture');

// --- A window stretched back over the whole clip is stored as no entry ---
assert.deepEqual(withFxTiming({ fxTiming: { blur: { start: 2, duration: 2 } } }, 'blur', { start: 0, duration: 6 }, 6), {}, 'full-span window collapses to absent');
assert.equal(fxTimingOf({ fxTiming: { blur: { start: 0, duration: 0 } } }, 'blur'), null, 'a zero-length window reads as untimed');

// --- Removing the effect removes its window with it ---
st = fresh(mkClip({ fxTiming: { blur: { start: 1, duration: 2 }, [PIX]: { start: 0, duration: 3 } } }));
st = run(st, { type: 'removeEffect', id: 'video|a|blur' });
assert.deepEqual(host().effects, [PIX], 'the effect itself is removed');
assert.deepEqual(host().fxTiming, { [PIX]: { start: 0, duration: 3 } }, 'only the removed instance’s window goes');

// --- Shader passes: a timed pixel effect acts only inside its window, T from the window ---
const pixClip = (patch = {}) => ({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: [PIX], ...patch });
let proj = { ...fresh(pixClip()).present };
const passesAt = (p, clip, lt) => pixelPasses(p, clip, 0, lt);
assert.equal(passesAt(proj, pixClip(), 0.5).length, 1, 'untimed pixel effect passes from the clip start');
assert.equal(passesAt(proj, pixClip(), 0.5)[0].T, 0.5, 'untimed T starts with the clip');
const timedPix = pixClip({ fxTiming: { [PIX]: { start: 2, duration: 2 } } });
assert.equal(passesAt(proj, timedPix, 1).length, 0, 'no pass before the window');
assert.equal(passesAt(proj, timedPix, 2.5).length, 1, 'a pass inside the window');
assert.equal(passesAt(proj, timedPix, 2.5)[0].T, 0.5, 'timed T starts with the window');
assert.equal(passesAt(proj, timedPix, 4).length, 0, 'no pass at/after the window end');

// --- A timed classic effect routes through its shader form (the look paths skip it) ---
const blurClip = (patch = {}) => ({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: ['blur'], ...patch });
assert.equal(classicViaShader(blurClip(), 'blur'), false, 'untimed blur stays on the look path');
assert.equal(passesAt(proj, blurClip(), 1.5).length, 0, 'untimed blur has no shader pass');
const timedBlur = blurClip({ fxTiming: { blur: { start: 1, duration: 2 } } });
assert.equal(classicViaShader(timedBlur, 'blur'), true, 'timed blur is routed via shader');
assert.equal(passesAt(proj, timedBlur, 0.5).length, 0, 'timed blur: nothing before the window');
assert.equal(passesAt(proj, timedBlur, 1.5).length, 1, 'timed blur: a shader pass inside the window');
assert.equal(passesAt(proj, timedBlur, 1.5)[0].T, 0.5, 'timed blur T starts with the window');

// --- Overlay layers: export ranges shrink to the window ---
const snowClip = (patch = {}) => ({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, effects: [SNOW], ...patch });
proj = { ...fresh(snowClip()).present };
assert.deepEqual(overlayRanges(proj), [[0, 6]], 'untimed overlay effect covers the clip');
proj = { ...fresh(snowClip({ fxTiming: { [SNOW]: { start: 1, duration: 2 } } })).present };
assert.deepEqual(overlayRanges(proj), [[1, 3]], 'timed overlay effect covers only its window');

// --- Overlay layers: the draw itself is gated (counting stub context) ---
const countingCtx = () => {
  let calls = 0;
  const grad = { addColorStop() {} };
  const fn = () => { calls++; return grad; };
  const ctx = new Proxy({}, {
    get: (t, p) => (p === 'canvas' ? { width: 96, height: 54 } : fn),
    set: () => true,
  });
  return { ctx, calls: () => calls };
};
const drawCallsAt = (p, t) => { const c = countingCtx(); drawOverlayPasses(c.ctx, p, t, 96, 54); return c.calls(); };
proj = { ...fresh(snowClip({ fxTiming: { [SNOW]: { start: 2, duration: 2 } } })).present };
assert.equal(drawCallsAt(proj, 1), 0, 'overlay: nothing drawn before the window');
assert.ok(drawCallsAt(proj, 3) > 0, 'overlay: drawn inside the window');
assert.equal(drawCallsAt(proj, 5), 0, 'overlay: nothing drawn after the window');
proj = { ...fresh(snowClip()).present };
assert.ok(drawCallsAt(proj, 5) > 0, 'overlay: untimed instance still drawn late in the clip');

// --- Overlay-track hosts carry windows too ---
st = fresh(mkClip());
st.present.overlayClips = [{ id: 'ov', mediaId: 'm', start: 10, in: 0, out: 4, speed: 1, effects: ['blur'], fxTiming: { blur: { start: 1, duration: 2 } } }];
const ovObj = effectObjects(st.present).find((o) => o.key === 'overlay|ov|blur');
assert.deepEqual([ovObj.start, ovObj.duration], [11, 2], 'an overlay clip’s bound window is offset by the clip start');

console.log('FX-TIMING OK');
