// Media pool operations (checklist #9, #14): renameMedia patches the display
// name only (path, clips and generated pointers untouched) and is an undo
// step; duplicating via addMedia mints a second pool entry on the same file
// without touching clips; removing several items inside one gesture is a
// single undo step.
// Usage: node scripts/test-media-library.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer } from '../src/store.js';

const media = [
  { id: 'm1', name: 'a.mp4', path: '/x/a.mp4', type: 'video', duration: 10, width: 1920, height: 1080, thumb: '/cache/a.jpg', proxy: '/cache/a-proxy.mp4' },
  { id: 'm2', name: 'b.mp3', path: '/x/b.mp3', type: 'audio', duration: 20 },
];
const project = () => ({
  ...emptyProject(), id: 'p1', media: structuredClone(media),
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1 }],
  audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 5 }],
});

let state = { past: [], present: emptyProject(), future: [] };
state = historyReducer(state, { type: 'load', project: project() });

// --- renameMedia: name only, undoable ---
state = historyReducer(state, { type: 'renameMedia', id: 'm1', name: 'renamed.mp4' });
assert.equal(state.past.length, 1, 'rename is one undo step');
const m1 = state.present.media.find((m) => m.id === 'm1');
assert.equal(m1.name, 'renamed.mp4');
assert.equal(m1.path, '/x/a.mp4', 'rename never moves the file path');
assert.equal(m1.thumb, '/cache/a.jpg', 'rename keeps generated pointers');
assert.equal(state.present.media.find((m) => m.id === 'm2').name, 'b.mp3', 'other items untouched');
assert.equal(state.present.videoClips[0].mediaId, 'm1', 'clips keep pointing at the renamed item');
state = historyReducer(state, { type: 'undo' });
assert.equal(state.present.media.find((m) => m.id === 'm1').name, 'a.mp4', 'undo restores the old name');
state = historyReducer(state, { type: 'redo' });
assert.equal(state.present.media.find((m) => m.id === 'm1').name, 'renamed.mp4', 'redo re-applies the rename');

// --- duplicate via addMedia: same file, new id, no clips copied ---
state = historyReducer(state, { type: 'addMedia', items: [{ ...state.present.media.find((m) => m.id === 'm1'), id: 'm1-copy' }] });
assert.equal(state.present.media.filter((m) => m.path === '/x/a.mp4').length, 2, 'two pool entries share the file');
assert.equal(state.present.media.find((m) => m.id === 'm1-copy').name, 'renamed.mp4', 'the copy keeps the (renamed) display name');
assert.equal(state.present.videoClips.length, 1, 'duplicating adds no clips');

// --- bulk remove in one gesture: one undo step for both items ---
state = historyReducer(state, { type: 'beginGesture' });
state = historyReducer(state, { type: 'removeMedia', id: 'm1' });
state = historyReducer(state, { type: 'removeMedia', id: 'm2' });
state = historyReducer(state, { type: 'endGesture' });
assert.equal(state.present.media.length, 1, 'both removed, the copy stays');
assert.equal(state.present.videoClips.length, 0, 'clips using a removed item go too');
assert.equal(state.present.audioClips.length, 0);
state = historyReducer(state, { type: 'undo' });
assert.equal(state.present.media.length, 3, 'one undo restores the whole bulk remove');
assert.equal(state.present.videoClips.length, 1);
assert.equal(state.present.audioClips.length, 1);

console.log('media-library ok: rename / duplicate / bulk-remove in one undo step');
