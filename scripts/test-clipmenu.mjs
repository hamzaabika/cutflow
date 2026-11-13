// Clip menu actions: move between main and overlay, extract audio, paste, deactivate. Usage: node scripts/test-clipmenu.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, pickAttributes, renderable, replaceClipPatch, videoLayout } from '../src/store.js';
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
assert.deepEqual(st.present.videoClips[0].transform, { scale: 1, scaleX: 1, scaleY: 1, uniform: true, x: 0, y: 0, rot: 0 });
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

// Replace clip (item 5): timing preserved, media-bound state dropped.
const oldV = { id: 'v', type: 'video', duration: 10, hasAudio: true };
const longV = { id: 'w', type: 'video', duration: 30, hasAudio: true };
const shortV = { id: 'x', type: 'video', duration: 1, hasAudio: true };
const img = { id: 'i', type: 'image' };
const clip = { ...mk('a', 'v', 2), in: 1, out: 3, speedCurve: { points: [] }, reversed: { mediaId: 'v' }, enhance: { path: 'e.wav', on: true }, filter: 'bw', transform: { scale: 1.5 } };
assert.deepEqual(replaceClipPatch(clip, oldV, longV), { mediaId: 'w', in: 0, out: 2, speedCurve: undefined, reversed: null, enhance: undefined });
assert.deepEqual(replaceClipPatch(clip, oldV, shortV), { mediaId: 'x', in: 0, out: 1, speedCurve: undefined, reversed: null, enhance: undefined });
assert.equal(replaceClipPatch(clip, oldV, img).out, 2); // images hold the frame: span kept

console.log('CLIP MENU OK');
