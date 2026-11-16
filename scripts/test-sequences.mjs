// Multiple sequences (P2-02). Usage: node scripts/test-sequences.mjs
import assert from 'assert/strict';
import {
  canNest, createSequence, deleteSequence, ensureSequences, flattenProject,
  layoutOf, newSequenceClip, nextSequenceName, renameSequence, sequenceContains,
  sequenceDuration, sequenceUsedBy, switchSequence, syncActiveSequence, timelineDuration,
} from '../src/sequences.js';
import { emptyProject, historyReducer, normalizeProject, projectDuration, videoLayout } from '../src/store.js';

const vid = (id, mediaId, len) => ({ id, mediaId, in: 0, out: len, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null });
const media = (id, len) => ({ id, type: 'video', name: id, duration: len, path: `/tmp/${id}.mp4` });

// layoutOf agrees with the store's videoLayout on shared fixtures.
{
  const clips = [vid('a', 'm1', 4), { ...vid('b', 'm2', 3), transition: { type: 'dissolve', duration: 1 } }, vid('c', 'm3', 2)];
  const mine = layoutOf(clips);
  const theirs = videoLayout(clips);
  assert.deepEqual(mine.map((l) => [l.start, l.end, l.trans]), theirs.map((l) => [l.start, l.end, l.trans]), 'layoutOf matches videoLayout');
}

// --- Migration: an old single-timeline project loads as one default sequence.
let old = emptyProject();
old = { ...old, sequences: undefined, activeSequenceId: undefined };
old.media = [media('m1', 4)];
old.videoClips = [vid('a', 'm1', 4)];
old.textClips = [{ id: 't1', text: 'Hi', start: 1, duration: 2, y: 0.5 }];
const migrated = normalizeProject(old);
assert.equal(migrated.sequences.length, 1, 'old project gains one sequence');
assert.equal(migrated.sequences[0].name, 'Sequence 1');
assert.equal(migrated.activeSequenceId, migrated.sequences[0].id);
assert.deepEqual(migrated.videoClips, old.videoClips, 'flat timeline untouched by migration');
assert.deepEqual(migrated.sequences[0].timeline.videoClips, old.videoClips, 'default sequence holds the old timeline');
assert.equal(projectDuration(migrated), 4, 'migrated project duration identical');
// Migration is idempotent.
const migrated2 = normalizeProject(JSON.parse(JSON.stringify(migrated)));
assert.equal(migrated2.sequences.length, 1);
assert.equal(migrated2.activeSequenceId, migrated.activeSequenceId);
assert.deepEqual(migrated2.videoClips, migrated.videoClips);

// --- Create / switch / rename / delete through the real reducer (undo included).
let state = { past: [], present: migrated, future: [] };
const dispatch = (a) => { state = historyReducer(state, a); };
dispatch({ type: 'createSequence' });
assert.equal(state.present.sequences.length, 2, 'create adds a sequence');
assert.equal(state.present.videoClips.length, 0, 'new sequence starts empty');
const seqB = state.present.activeSequenceId;
assert.equal(state.present.sequences[1].name, 'Sequence 2', 'second sequence auto-named');
assert.equal(state.present.sequences[0].timeline.videoClips.length, 1, 'switching away saved Sequence 1');
dispatch({ type: 'addToTimeline', mediaId: 'm1', clipId: 'b1', index: 0 });
assert.equal(state.present.videoClips.length, 1, 'edit lands on Sequence 2 only');
dispatch({ type: 'switchSequence', id: state.present.sequences[0].id });
assert.equal(state.present.videoClips.length, 1, 'back on Sequence 1: its clip is there');
assert.equal(state.present.videoClips[0].id, 'a');
dispatch({ type: 'switchSequence', id: seqB });
assert.equal(state.present.videoClips[0].id, 'b1', 'Sequence 2 kept its own edit');
dispatch({ type: 'renameSequence', id: seqB, name: '  B-roll  ' });
assert.equal(state.present.sequences.find((s) => s.id === seqB).name, 'B-roll', 'rename trims');
dispatch({ type: 'renameSequence', id: seqB, name: '   ' });
assert.equal(state.present.sequences.find((s) => s.id === seqB).name, 'B-roll', 'blank rename refused');
dispatch({ type: 'undo' });
assert.equal(state.present.sequences.find((s) => s.id === seqB).name, 'Sequence 2', 'rename undoes');
// Delete the non-active sequence, then refuse to delete the last one.
dispatch({ type: 'switchSequence', id: seqB });
dispatch({ type: 'deleteSequence', id: state.present.sequences[0].id });
assert.equal(state.present.sequences.length, 1, 'delete removes a sequence');
assert.equal(state.present.activeSequenceId, seqB);
dispatch({ type: 'deleteSequence', id: seqB });
assert.equal(state.present.sequences.length, 1, 'last sequence cannot be deleted');
// nextSequenceName skips taken names.
assert.equal(nextSequenceName({ sequences: [{ name: 'Sequence 1' }, { name: 'Sequence 2' }] }), 'Sequence 3');

// --- Nesting: a sequence clip flattens to the source's clips.
let p = emptyProject();
p = normalizeProject(p);
p.media = [media('m1', 4), media('m2', 6)];
const seqA = p.activeSequenceId;
p = { ...p, videoClips: [vid('a1', 'm1', 4)], textClips: [{ id: 'ta', text: 'cap', start: 1, duration: 2, y: 0.5 }] };
p = syncActiveSequence(p);
p = createSequence(p, 'Main');
const seqMain = p.activeSequenceId;
const durA = sequenceDuration(p, seqA);
assert.equal(durA, 4, 'sequenceDuration reads the source timeline');
assert.equal(canNest(p, seqA), true, 'Main may nest Sequence 1');
assert.equal(canNest(p, seqMain), false, 'a sequence cannot nest itself');
p = { ...p, videoClips: [newSequenceClip('n1', seqA, 'Sequence 1', durA)] };
p = syncActiveSequence(p);
const flat = flattenProject(p);
assert.equal(flat.videoClips.length, 1, 'nested clip expands to one clip');
assert.equal(flat.videoClips[0].mediaId, 'm1', 'flattened clip carries the source media');
assert.equal(flat.videoClips[0].id, 'n1:a1', 'flattened clip id is namespaced');
assert.equal(flat.videoClips[0].in, 0);
assert.equal(flat.videoClips[0].out, 4);
assert.equal(flat.textClips.length, 1, 'nested text clip follows');
assert.equal(flat.textClips[0].text, 'cap');
assert.equal(flat.textClips[0].start, 1, 'nested text keeps its offset inside the window');
assert.equal(projectDuration(flat), 4, 'flattened duration equals the window');
// Flatten is idempotent and a no-op without sequence clips.
assert.deepEqual(flattenProject(flat).videoClips, flat.videoClips, 'flattening twice is stable');
const plain = normalizeProject(emptyProject());
assert.equal(flattenProject(plain), plain, 'no sequence clips: same reference back');
// Updates propagate: editing the source re-flattens differently.
let p2 = { ...p, sequences: p.sequences.map((s) => (s.id === seqA ? { ...s, timeline: { ...s.timeline, videoClips: [vid('a2', 'm2', 6)] } } : s)) };
assert.equal(flattenProject(p2).videoClips[0].mediaId, 'm2', 'source edit propagates through the nested clip');

// --- Cycles: direct and indirect.
let c = normalizeProject(emptyProject());
c.media = [media('m1', 4)];
c = { ...c, videoClips: [vid('x1', 'm1', 4)] };
c = syncActiveSequence(c);
const cA = c.activeSequenceId;
c = createSequence(c, 'B');
const cB = c.activeSequenceId;
c = { ...c, videoClips: [newSequenceClip('nB', cA, 'A', 4)] };
c = syncActiveSequence(c);
assert.equal(sequenceContains(c, cB, cA), true, 'B contains A');
assert.equal(canNest(c, cB, cA), false, 'nesting B inside A would close a cycle');
assert.equal(canNest(c, cA, cB), true, 'nesting A inside B is fine (B already has A? no — A is the parent here)');
c = switchSequence(c, cA);
assert.equal(canNest(c, cB), false, 'from A, B cannot nest: B contains A');
// The reducer refuses a cyclic insert even if the UI did not.
let cState = { past: [], present: c, future: [] };
cState = historyReducer(cState, { type: 'addSequenceClip', clipId: 'bad', sequenceId: cB });
assert.equal(cState.present.videoClips.length, 1, 'cyclic addSequenceClip refused');
assert.ok(!cState.present.videoClips.some((x) => x.id === 'bad'));
// Delete refuses a sequence that is in use as a nested clip.
assert.equal(sequenceUsedBy(c, cA).length, 1, 'A is used by B');
cState = historyReducer(cState, { type: 'deleteSequence', id: cA });
assert.equal(cState.present.sequences.length, 2, 'in-use sequence cannot be deleted');

// --- Nested window: partial window + free-track truncation + pad gap.
let w = normalizeProject(emptyProject());
w.media = [media('m1', 10), media('m2', 10)];
const wA = w.activeSequenceId;
w = { ...w, videoClips: [vid('w1', 'm1', 6), vid('w2', 'm2', 6)], textClips: [{ id: 'tw', text: 'long', start: 0, duration: 12, y: 0.5 }] };
w = syncActiveSequence(w);
w = createSequence(w, 'Main');
w = { ...w, videoClips: [{ ...newSequenceClip('nw', wA, 'A', 12), in: 2, out: 9 }] };
const wf = flattenProject(w);
assert.equal(wf.videoClips.filter((x) => !x.gap).length, 2, 'window covers parts of both source clips');
assert.equal(wf.videoClips[0].in, 2, 'first clip trimmed to the window start');
assert.equal(wf.videoClips[1].out, 3, 'second clip trimmed to the window end (source seconds)');
assert.equal(projectDuration(wf), 7, 'flattened window is exactly 7s (no pad needed)');
assert.equal(wf.textClips[0].start, 0, 'text clipped to the window start');
assert.equal(wf.textClips[0].duration, 7, 'text truncated to the window');
// Short source, long window: pad gap keeps later parent clips in place.
let s2 = normalizeProject(emptyProject());
s2.media = [media('m1', 2)];
const s2A = s2.activeSequenceId;
s2 = { ...s2, videoClips: [vid('s1', 'm1', 2)] };
s2 = syncActiveSequence(s2);
s2 = createSequence(s2, 'Main');
s2 = { ...s2, videoClips: [{ ...newSequenceClip('ns', s2A, 'A', 5), in: 0, out: 5 }, vid('after', 'm1', 3)] };
const s2f = flattenProject(s2);
assert.equal(projectDuration(s2f), 8, 'padded nested segment keeps the following clip at 5s');
assert.equal(s2f.videoClips.filter((x) => x.gap).length, 1, 'pad gap fills the short source');
// Split halves a sequence clip's window (generic split path, no media needed).
let sp = { past: [], present: s2, future: [] };
sp = historyReducer(sp, { type: 'split', track: 'video', id: 'ns', t: 1, newId: 'ns2' });
assert.equal(sp.present.videoClips.filter((x) => x.sequenceId).length, 2, 'split produces two sequence clips');
assert.deepEqual(sp.present.videoClips.filter((x) => x.sequenceId).map((x) => [x.in, x.out]), [[0, 1], [1, 5]], 'split windows partition the source');

console.log('sequences OK: migration, create/switch/rename/delete + undo, nesting flatten, cycles, delete guard, window/pad, split');
