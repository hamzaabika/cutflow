// Mid-session relink prompt (P1-28): only newly-lost files open the dialog.
// Usage: node scripts/test-midsession-relink.mjs
import assert from 'node:assert/strict';
import { historyReducer, newlyMissingIds, normalizeProject } from '../src/store.js';

const media = [
  { id: 'a', path: '/x/a.mp4' },
  { id: 'b', path: '/x/b.mp4', missing: true },
  { id: 'c', path: '/x/c.mp4' },
];
// Nothing newly lost when the missing set is unchanged.
assert.deepEqual(newlyMissingIds([{ id: 'b' }], media), []);
// A file that was present and is now gone is newly lost.
assert.deepEqual(newlyMissingIds([{ id: 'a' }, { id: 'b' }], media).map((m) => m.id), ['a']);
// A file that came back is not newly lost; an unknown id in the report is.
assert.deepEqual(newlyMissingIds([{ id: 'z' }], media).map((m) => m.id), ['z']);
assert.deepEqual(newlyMissingIds([], media), []);

// The flags themselves still refresh project-wide (non-merge): a file that
// came back clears, so a later loss prompts again.
const st = {
  past: [],
  present: { ...normalizeProject({}), media: [{ id: 'a', path: '/x/a.mp4', missing: true }] },
  future: [],
};
const cleared = historyReducer(st, { type: 'setMediaMissing', ids: [] });
assert.equal(cleared.present.media[0].missing, undefined);
assert.deepEqual(newlyMissingIds([{ id: 'a' }], cleared.present.media).map((m) => m.id), ['a']);

console.log('MIDSESSION RELINK OK');
