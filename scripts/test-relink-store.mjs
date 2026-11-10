// Relink persistence (src/store.js 'relinkMedia'): applying located paths patches the
// media entries in the present AND every history state (a repair, not an undo step),
// drops the generated pointers recorded against the old location, leaves other media
// alone, and the corrected paths survive a save/load round trip.
// Usage: node scripts/test-relink-store.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, normalizeProject } from '../src/store.js';

const media = [
  { id: 'm1', name: 'a.mp4', path: '/old/a.mp4', type: 'video', duration: 10, width: 1920, height: 1080, thumb: '/cache/a.jpg', wave: '/cache/a.png', proxy: '/cache/a-proxy.mp4' },
  { id: 'm2', name: 'b.mp3', path: '/old/b.mp3', type: 'audio', duration: 20 },
];
const project = () => ({
  ...emptyProject(), id: 'p1', media: structuredClone(media),
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1 }],
  audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 5 }],
});

// Build a history: load, then one ordinary edit so a past state exists.
let state = { past: [], present: emptyProject(), future: [] };
state = historyReducer(state, { type: 'load', project: project() });
state = historyReducer(state, { type: 'setProject', patch: { name: 'Edited' } });
assert.equal(state.past.length, 1);
const pastDepth = state.past.length;

// Relink both items to their new homes.
state = historyReducer(state, {
  type: 'relinkMedia',
  updates: [
    { id: 'm1', path: '/new/home/a.mp4', duration: 10, width: 1920, height: 1080, verified: true },
    { id: 'm2', path: '/new/home/b.mp3', duration: 20 },
  ],
});

// Not an undo step: history depth is unchanged, and there is nothing new to undo to.
assert.equal(state.past.length, pastDepth);

// Present points at the new locations, with probed fields refreshed.
const m1 = state.present.media.find((m) => m.id === 'm1');
assert.equal(m1.path, '/new/home/a.mp4');
assert.equal(m1.duration, 10);
// Generated pointers from the old location are gone (they regenerate for the new path).
assert.equal(m1.thumb, undefined);
assert.equal(m1.wave, undefined);
assert.equal(m1.proxy, undefined);
// The helper fields of the update itself never land on the media entry.
assert.equal(m1.verified, undefined);

// The past state was patched too: undoing the rename edit cannot resurrect dead paths.
const pastM1 = state.past[state.past.length - 1].media.find((m) => m.id === 'm1');
assert.equal(pastM1.path, '/new/home/a.mp4');
const undone = historyReducer(state, { type: 'undo' });
assert.equal(undone.present.media.find((m) => m.id === 'm1').path, '/new/home/a.mp4');
assert.equal(undone.present.media.find((m) => m.id === 'm2').path, '/new/home/b.mp3');
assert.equal(undone.present.name, 'Untitled'); // the edit itself still undid

// A relink for an unknown id is a no-op (same state object back).
const same = historyReducer(state, { type: 'relinkMedia', updates: [{ id: 'nope', path: '/x' }] });
assert.equal(same.present, state.present);

// Round trip: the relinked project serializes and reloads with the new paths.
const reloaded = normalizeProject(JSON.parse(JSON.stringify(state.present)));
assert.equal(reloaded.media.find((m) => m.id === 'm1').path, '/new/home/a.mp4');
assert.equal(reloaded.videoClips.length, 1); // clips survive: they reference media by id

console.log('test-relink-store: all assertions passed');
