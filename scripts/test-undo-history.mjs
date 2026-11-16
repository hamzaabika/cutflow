// B-UX7 — visible undo history: the reducer carries pastMeta/futureMeta
// ({ type, at }) parallel to past/future through undo, redo, undoTo,
// redoTo, collapseHistory, gestures and loads, so the panel always lists
// the true trail. The panel itself (UndoHistoryPanel.jsx) is source-checked
// here and driven live in the CDP pass.
// Usage: node scripts/test-undo-history.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { historyReducer, normalizeProject } from '../src/store.js';

const run = (st, ...actions) => actions.reduce(historyReducer, st);
const fresh = () => ({
  past: [],
  present: { ...normalizeProject({}), id: 'docA', media: [{ id: 'v', type: 'video', duration: 10, hasAudio: true }], videoClips: [{ id: 'a', mediaId: 'v', in: 0, out: 2, speed: 1, volume: 1, muted: false, transition: null }] },
  future: [],
});
const metaTypes = (st) => (st.pastMeta || []).map((m) => m.type);
const checkParallel = (st, label) => {
  assert.equal((st.pastMeta || []).length, st.past.length, `${label}: pastMeta stays parallel to past`);
  assert.equal((st.futureMeta || []).length, st.future.length, `${label}: futureMeta stays parallel to future`);
};

const upd = (filter) => ({ type: 'update', track: 'video', id: 'a', patch: { filter } });

// Three edits record three typed, timestamped meta entries.
let st = run(fresh(), upd('bw'), upd('vivid'), upd('noir'));
assert.deepEqual(metaTypes(st), ['update', 'update', 'update'], 'three edits record three update metas');
assert.ok(st.pastMeta.every((m) => typeof m.at === 'number' && m.at > 0), 'every meta entry carries a timestamp');
checkParallel(st, 'after edits');

// Undo moves the last meta onto the redo branch, in order.
st = run(st, { type: 'undo' });
assert.equal(st.present.videoClips[0].filter, 'vivid', 'undo restores the previous filter');
assert.deepEqual(metaTypes(st), ['update', 'update'], 'undo drops the last past meta');
assert.deepEqual((st.futureMeta || []).map((m) => m.type), ['update'], 'the undone edit becomes the redo meta');
checkParallel(st, 'after undo');

// Redo moves it back.
st = run(st, { type: 'redo' });
assert.equal(st.present.videoClips[0].filter, 'noir', 'redo restores the undone filter');
assert.deepEqual(metaTypes(st), ['update', 'update', 'update'], 'redo restores the past meta');
assert.equal(st.future.length, 0, 'redo empties the future branch');
checkParallel(st, 'after redo');

// undoTo(0) jumps to the start; the whole trail becomes redoable, metas intact.
st = run(st, { type: 'undoTo', depth: 0 });
assert.equal(st.present.videoClips[0].filter, undefined, 'undoTo 0 restores the pre-edit project');
assert.equal(st.past.length, 0, 'undoTo 0 empties the past');
assert.equal(st.future.length, 3, 'undoTo 0 puts all three states on the redo branch');
assert.equal((st.futureMeta || []).length, 3, 'undoTo 0 carries all three metas onto the redo branch');
checkParallel(st, 'after undoTo');

// redoTo(1) jumps forward two steps (past gains present + future[0]).
st = run(st, { type: 'redoTo', index: 1 });
assert.equal(st.present.videoClips[0].filter, 'vivid', 'redoTo 1 lands on the second state');
assert.equal(st.past.length, 2, 'redoTo moves the passed states into the past');
assert.equal(st.future.length, 1, 'redoTo leaves the later state redoable');
assert.deepEqual(metaTypes(st), ['update', 'update'], 'redoTo carries the passed metas into the past');
checkParallel(st, 'after redoTo');

// A gesture folds into one 'gesture' meta entry.
let g = run(fresh(), { type: 'beginGesture' }, upd('bw'), upd('vivid'), { type: 'endGesture' });
assert.equal(g.past.length, 1, 'a gesture is one undo step');
assert.deepEqual(metaTypes(g), ['gesture'], 'a gesture records one grouped meta entry');
checkParallel(g, 'after gesture');

// collapseHistory folds the trail and its metas together.
let c = run(fresh(), upd('bw'), upd('vivid'), upd('noir'), { type: 'collapseHistory', from: 0 });
assert.equal(c.past.length, 1, 'collapseHistory folds to a single step');
assert.equal((c.pastMeta || []).length, 1, 'collapseHistory folds the metas too');
checkParallel(c, 'after collapse');

// Same-document load keeps the trail + metas; a different document wipes both.
let l = run(fresh(), upd('bw'), { type: 'load', project: { ...normalizeProject({}), id: 'docA' } });
assert.equal(l.past.length, 1, 'same-doc load keeps the trail');
assert.equal((l.pastMeta || []).length, 1, 'same-doc load keeps the metas');
l = run(l, { type: 'load', project: { ...normalizeProject({}), id: 'docB' } });
assert.equal(l.past.length, 0, 'different-doc load wipes the trail');
assert.equal((l.pastMeta || []).length, 0, 'different-doc load wipes the metas');

// The panel renders the trail (source check — live driving is the CDP pass).
const panel = fs.readFileSync(new URL('../src/components/UndoHistoryPanel.jsx', import.meta.url), 'utf8');
assert.ok(panel.includes("dispatch({ type: 'undoTo'"), 'panel jumps back with undoTo');
assert.ok(panel.includes("dispatch({ type: 'redoTo'"), 'panel jumps forward with redoTo');
assert.ok(panel.includes('uh.current'), 'panel marks the current state');
const tl = fs.readFileSync(new URL('../src/components/Timeline.jsx', import.meta.url), 'utf8');
assert.ok(tl.includes('onOpenUndoHistory') && tl.includes('tl.undoHistory'), 'timeline history button opens the panel');

console.log('undo-history: all checks passed');
