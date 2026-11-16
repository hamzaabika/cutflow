// Clip menu actions: move between main and overlay, extract audio, paste, deactivate. Usage: node scripts/test-clipmenu.mjs
import assert from 'node:assert/strict';
import { clipLen, historyReducer, normalizeProject, pickAttributes, renderable, replaceClipPatch, replaceCompatible, videoLayout } from '../src/store.js';
import { resetTransformPatch } from '../src/visual.js';

const run = (st, ...actions) => actions.reduce(historyReducer, st);
const mk = (id, mediaId, len) => ({ id, mediaId, in: 0, out: len, speed: 1, volume: 1, muted: false, transition: null });
const fresh = () => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'v', type: 'video', duration: 10, hasAudio: true }, { id: 's', type: 'video', duration: 10, hasAudio: false }],
    videoClips: [mk('a', 'v', 2), mk('b', 'v', 3), mk('c', 's', 1)],
  },
  future: [],
});
const main = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${l.start}`).join(' ');

// Main -> overlay closes up the main track (magnet on), the clip keeps its look and lands at `at`.
let st = run(fresh(), { type: 'update', track: 'video', id: 'b', patch: { filter: 'bw' } }, { type: 'moveToOverlay', id: 'b', at: 1.5 });
assert.equal(main(st.present), 'a@0 c@2');
assert.deepEqual(st.present.overlayClips.map((c) => [c.id, c.start, c.filter]), [['b', 1.5, 'bw']]);
// ... and back to the main track at index 1, in one undo step each.
st = run(st, { type: 'moveToMain', id: 'b', index: 1 });
assert.equal(main(st.present), 'a@0 b@2 c@5');
assert.equal(st.present.overlayClips.length, 0);
assert.equal('start' in st.present.videoClips[1], false);
st = run(st, { type: 'undo' });
assert.equal(st.present.overlayClips.length, 1);

// Magnet off: moving away leaves a gap.
st = run(fresh(), { type: 'setMagnet', track: 'video', on: false }, { type: 'moveToOverlay', id: 'a', at: 0 });
assert.equal(main(st.present), 'GAP@0 b@2 c@5');

// Extract audio: an audio clip at the clip's timeline position, the clip muted; never for silent media or twice.
st = run(fresh(), { type: 'extractAudio', track: 'video', id: 'b', newId: 'x' });
assert.deepEqual(st.present.audioClips.map((c) => [c.id, c.start, c.in, c.out]), [['x', 2, 0, 3]]);
assert.equal(st.present.videoClips[1].muted, true);
const again = run(st, { type: 'extractAudio', track: 'video', id: 'b', newId: 'y' });
assert.equal(again.present.audioClips.length, 1);
assert.equal(run(fresh(), { type: 'extractAudio', track: 'video', id: 'c', newId: 'z' }).present.audioClips.length, 0);

// Paste: main clips go where the time falls, free clips start there.
st = run(fresh(), { type: 'paste', track: 'video', clip: mk('a', 'v', 2), at: 2.4, newId: 'p1' });
assert.equal(main(st.present), 'a@0 p1@2 b@4 c@7');
st = run(st, { type: 'paste', track: 'overlay', clip: { ...mk('q', 'v', 2), start: 9 }, at: 1, newId: 'p2' });
assert.deepEqual(st.present.overlayClips.map((c) => [c.id, c.start]), [['p2', 1]]);

// Deactivated: a main clip plays as a gap, others are left out.
st = run(fresh(), { type: 'update', track: 'video', id: 'b', patch: { disabled: true } });
const r = renderable(st.present);
assert.equal(main(r), 'a@0 GAP@2 c@5');
const plain = fresh().present;
assert.equal(renderable(plain), plain, 'nothing deactivated: same object');

assert.deepEqual(pickAttributes({ id: 'k', filter: 'bw', transform: { scale: 2 }, in: 3 }), { filter: 'bw', transform: { scale: 2 } });

// Reset position and size (items 8 + 15): the menu's old `transform:
// undefined` patch left transform keyframes behind (the clip snapped back
// to its keyframed pose) and reset overlays to scale 1 instead of their
// 0.5 creation default. The shared reset drops the transform keys and
// restores the per-track default; other keyframes survive.
st = run(fresh(), { type: 'update', track: 'video', id: 'a', patch: { transform: { scale: 2, scaleX: 2, scaleY: 2, uniform: true, x: 30, y: -10, rot: 45 }, keyframes: { scale: [1], x: [1], opacity: [1] } } });
st = run(st, { type: 'update', track: 'video', id: 'a', patch: resetTransformPatch(st.present.videoClips[0], 'video') });
assert.deepEqual(st.present.videoClips[0].transform, { scale: 1, scaleX: 1, scaleY: 1, uniform: true, x: 0, y: 0, rot: 0, anchor: { x: 0.5, y: 0.5 } });
assert.deepEqual(st.present.videoClips[0].keyframes, { opacity: [1] });
st = run(fresh(), { type: 'moveToOverlay', id: 'b', at: 1.5 });
st = run(st, { type: 'update', track: 'overlay', id: 'b', patch: resetTransformPatch({ ...st.present.overlayClips[0], transform: { scale: 2, x: 5 }, keyframes: { rot: [1] } }, 'overlay') });
assert.equal(st.present.overlayClips[0].transform.scale, 0.5);
assert.equal(st.present.overlayClips[0].keyframes, undefined);

// Copy attributes (item 15): the old shallow copy shared the source
// clip's nested objects — editing one clip then moved the other.
const srcAttrs = { id: 'k', filter: 'bw', transform: { scale: 2, x: 5 }, effects: ['mirror'] };
const copiedAttrs = pickAttributes(srcAttrs);
srcAttrs.transform.scale = 9; srcAttrs.effects.push('glow');
assert.deepEqual(copiedAttrs, { filter: 'bw', transform: { scale: 2, x: 5 }, effects: ['mirror'] });
// ... and pasting the copy onto another clip leaves the two clips unlinked.
st = run(fresh(), { type: 'update', track: 'video', id: 'a', patch: { transform: { scale: 2, x: 5 } } });
const attrs = pickAttributes(st.present.videoClips[0]);
st = run(st, { type: 'update', track: 'video', id: 'b', patch: attrs });
st = run(st, { type: 'update', track: 'video', id: 'a', patch: { transform: { scale: 7, x: 5 } } });
assert.equal(st.present.videoClips[1].transform.scale, 2);

// Remove filter (item 15): the menu greys it out when there is no filter;
// with one set, the update clears it.
st = run(fresh(), { type: 'update', track: 'video', id: 'a', patch: { filter: 'bw' } });
st = run(st, { type: 'update', track: 'video', id: 'a', patch: { filter: 'none' } });
assert.equal(st.present.videoClips[0].filter, 'none');

// Replace clip (items 5 + 20): a pure media swap — the trim (in/out) is
// kept, and the speed ramp survives via the reducer's curve slice; only
// media-bound renders (reversed, enhance) are dropped. Note the patch
// carries NO speedCurve key at all: its absence is what keeps the curve.
const oldV = { id: 'v', type: 'video', duration: 10, hasAudio: true };
const longV = { id: 'w', type: 'video', duration: 30, hasAudio: true };
const shortV = { id: 'x', type: 'video', duration: 1, hasAudio: true };
const midV = { id: 'y', type: 'video', duration: 2.5, hasAudio: true };
const img = { id: 'i', type: 'image' };
const clip = { ...mk('a', 'v', 2), in: 1, out: 3, speedCurve: { points: [] }, reversed: { mediaId: 'v' }, enhance: { path: 'e.wav', on: true }, filter: 'bw', transform: { scale: 1.5 } };
assert.deepEqual(replaceClipPatch(clip, oldV, longV), { mediaId: 'w', in: 1, out: 3, reversed: null, enhance: undefined });
assert.deepEqual(replaceClipPatch(clip, oldV, midV), { mediaId: 'y', in: 1, out: 2.5, reversed: null, enhance: undefined }); // shorter file: trim kept, span shrinks
assert.deepEqual(replaceClipPatch(clip, oldV, shortV), { mediaId: 'x', in: 0, out: 1, reversed: null, enhance: undefined }); // in-point past the end: fall back to the start, span kept
assert.deepEqual(replaceClipPatch(clip, oldV, img), { mediaId: 'i', in: 1, out: 3, reversed: null, enhance: undefined }); // images hold the frame: trim kept
// A ramped clip keeps its speed ramp through a replace (the patch omits
// speedCurve, so applyClipPatch slices the curve to the kept window —
// a no-op slice when in/out are unchanged).
let stR = run(fresh(), { type: 'update', track: 'video', id: 'a', patch: { in: 1, out: 3, speedCurve: { points: [{ t: 0, speed: 0.5 }, { t: 2, speed: 2 }] } } });
const beforeRamp = stR.present.videoClips[0];
stR = run(stR, { type: 'update', track: 'video', id: 'a', patch: replaceClipPatch(beforeRamp, oldV, longV) });
const afterRamp = stR.present.videoClips[0];
assert.equal(afterRamp.mediaId, 'w');
assert.equal(afterRamp.in, 1);
assert.equal(afterRamp.out, 3);
assert.deepEqual(afterRamp.speedCurve.points, [{ t: 0, speed: 0.5 }, { t: 2, speed: 2 }]);
assert.equal(clipLen(afterRamp), clipLen(beforeRamp));

// Replace compatibility (item 18): the Upload picker and the library list
// share one predicate — what a file must be to replace a clip.
const aud = { id: 'a', type: 'audio' };
const vidNoAud = { id: 'n', type: 'video', duration: 5, hasAudio: false };
const vidSilent = { id: 's', type: 'video', hasAudio: true }; // probed for audio but no duration: unprobed
const missing = { id: 'm', type: 'video', duration: 5, hasAudio: true, missing: true };
assert.equal(replaceCompatible(null, false, false), false);
assert.equal(replaceCompatible(missing, false, false), false);
assert.equal(replaceCompatible(longV, false, false), true); // plain video
assert.equal(replaceCompatible(vidNoAud, false, false), true); // unlinked: silent video ok
assert.equal(replaceCompatible(vidNoAud, true, false), false); // linked: needs audio
assert.equal(replaceCompatible(vidSilent, false, false), false); // unprobed video
assert.equal(replaceCompatible(img, false, false), true); // image, unlinked
assert.equal(replaceCompatible(img, true, false), false); // image, linked: partner would go silent
assert.equal(replaceCompatible(aud, false, true), true); // audio track takes audio
assert.equal(replaceCompatible(longV, false, true), true); // audio track takes video with audio
assert.equal(replaceCompatible(vidNoAud, false, true), false); // audio track: silent video no
assert.equal(replaceCompatible(img, false, true), false); // audio track: no images

console.log('CLIP MENU OK');
