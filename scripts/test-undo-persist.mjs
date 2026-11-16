// Undo persistence across same-document loads + uid() hardening (P1-06).
// Usage: node scripts/test-undo-persist.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, uid } from '../src/store.js';

const run = (st, ...actions) => actions.reduce(historyReducer, st);
const fresh = (id) => ({
  past: [],
  present: { ...normalizeProject({}), id, media: [{ id: 'v', type: 'video', duration: 10, hasAudio: true }], videoClips: [{ id: 'a', mediaId: 'v', in: 0, out: 2, speed: 1, volume: 1, muted: false, transition: null }] },
  future: [],
});

// uid(): counter + timestamp + random — no collisions at project scale.
const seen = new Set();
for (let i = 0; i < 100000; i++) {
  const id = uid();
  assert.equal(typeof id, 'string');
  assert.ok(!/\s/.test(id), 'uid must not contain whitespace');
  assert.ok(!seen.has(id), `uid collision at ${i}: ${id}`);
  seen.add(id);
}
// Two uid() calls in the same millisecond must still differ (counter).
assert.notEqual(uid(), uid());

// Same-document reload keeps the undo trail; redo is dropped (new branch).
let st = run(fresh('docA'), { type: 'update', track: 'video', id: 'a', patch: { filter: 'bw' } });
assert.equal(st.past.length, 1);
assert.equal(st.present.videoClips[0].filter, 'bw');
st = run(st, { type: 'load', project: { ...st.present, name: 'Renamed' } });
assert.equal(st.past.length, 1, 'same-doc load must keep past');
assert.equal(st.future.length, 0);
assert.equal(st.present.name, 'Renamed');
assert.equal(st.present.videoClips[0].filter, 'bw');
st = run(st, { type: 'undo' });
assert.equal(st.present.videoClips[0].filter, undefined);
assert.equal(st.past.length, 0);

// Switching to a different project wipes the trail (past belongs to the old doc).
st = run(fresh('docA'), { type: 'update', track: 'video', id: 'a', patch: { filter: 'bw' } });
assert.equal(st.past.length, 1);
st = run(st, { type: 'load', project: { ...normalizeProject({}), id: 'docB' } });
assert.equal(st.past.length, 0, 'different-doc load must wipe past');
assert.equal(st.present.id, 'docB');

// A load with no id on either side is a switch, not a reload (safe default).
st = run(fresh('docA'), { type: 'update', track: 'video', id: 'a', patch: { filter: 'bw' } });
const noId = { ...st.present };
delete noId.id;
st = run(st, { type: 'load', project: noId });
assert.equal(st.past.length, 0);

// A gesture in flight is abandoned by a load (it referenced the pre-load state).
st = run(fresh('docA'), { type: 'beginGesture' });
assert.ok(st.gestureStart);
st = run(st, { type: 'load', project: { ...st.present } });
assert.equal(st.gestureStart, null);

console.log('UNDO PERSIST OK');
