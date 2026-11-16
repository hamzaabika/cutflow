// P1-01 (FB-02): overlapping cut ranges — one shared normalizeCutRanges.
// Property checks (overlapping, adjacent, nested, reversed, out-of-bounds,
// duplicate, non-finite) plus the audit repro: [{2,4},{3,5}] removes exactly
// 3 s and ripples text correctly. Usage: node scripts/test-cut-ranges.mjs
import assert from 'node:assert/strict';
import {
  cutRanges, cutFreeRanges, moveRanges, normalizeCutRanges,
  normalizeProject, videoLayout, projectDuration,
} from '../src/store.js';

const eq = (a, b, msg) => assert.deepEqual(a, b, msg);
const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}[${+l.clip.in.toFixed(2)}..${+l.clip.out.toFixed(2)}]`).join(' ');
const base = (clips) => ({
  ...normalizeProject({}),
  media: [{ id: 'm', type: 'video', duration: 60 }],
  videoClips: clips || [mk('a', 10)],
});

// --- normalizeCutRanges properties ---
eq(normalizeCutRanges([{ start: 2, end: 4 }, { start: 3, end: 5 }], 10), [{ start: 2, end: 5 }], 'overlapping merge');
eq(normalizeCutRanges([{ start: 3, end: 5 }, { start: 2, end: 4 }], 10), [{ start: 2, end: 5 }], 'reversed input merges the same');
eq(normalizeCutRanges([{ start: 2, end: 4 }, { start: 4, end: 6 }], 10), [{ start: 2, end: 6 }], 'adjacent (touching) merges');
eq(normalizeCutRanges([{ start: 2, end: 8 }, { start: 3, end: 5 }], 10), [{ start: 2, end: 8 }], 'nested collapses to the outer range');
eq(normalizeCutRanges([{ start: 2, end: 4 }, { start: 2, end: 4 }], 10), [{ start: 2, end: 4 }], 'duplicate collapses to one');
eq(normalizeCutRanges([{ start: -2, end: 3 }, { start: 8, end: 14 }], 10), [{ start: 0, end: 3 }, { start: 8, end: 10 }], 'out-of-bounds clamps to [0, duration]');
eq(normalizeCutRanges([{ start: NaN, end: 4 }, { start: 2, end: Infinity }, { start: 5, end: 5 }, null, { start: 6, end: 7 }], 10),
  [{ start: 6, end: 7 }], 'non-finite / empty / null ranges are dropped');
eq(normalizeCutRanges([{ start: 2, end: 2.005 }], 10), [], 'sliver <= 0.01 s is dropped');
eq(normalizeCutRanges([{ start: 1, end: 2 }, { start: 5, end: 6 }], 10),
  [{ start: 1, end: 2 }, { start: 5, end: 6 }], 'disjoint ranges stay separate and sorted');
eq(normalizeCutRanges(null, 10), [], 'null input -> []');
eq(normalizeCutRanges([{ start: 2, end: 4 }]), [{ start: 2, end: 4 }], 'no duration -> no clamp');

// --- Audit repro: [{2,4},{3,5}] removes exactly 3 s (not 4) ---
let p = cutRanges(base(), [{ start: 2, end: 4 }, { start: 3, end: 5 }]);
assert.equal(projectDuration(p), 7, 'overlapping repro removes exactly 3 s');
assert.equal(layout(p), 'a@0-2[0..2] a-c1@2-7[5..10]', 'repro pieces keep the right source windows');

// Text ripples with the same merged cut: a caption spanning the cut splits
// and shifts by exactly 3 s, not 4.
p = cutRanges({
  ...base(),
  textClips: [{ id: 't1', start: 0, duration: 10, text: 'hello world', words: [
    { text: 'hello', start: 0, end: 1 }, { text: 'world', start: 6, end: 7 },
  ] }],
}, [{ start: 2, end: 4 }, { start: 3, end: 5 }], { rippleText: true });
assert.equal(p.textClips.length, 2, 'caption splits into two pieces');
assert.equal(p.textClips[0].start, 0, 'first caption piece stays at 0');
assert.equal(p.textClips[0].duration, 2, 'first caption piece is 0..2');
assert.equal(p.textClips[1].start, 2, 'second caption piece shifts by exactly 3 s');
assert.equal(p.textClips[1].duration, 5, 'second caption piece is 5..10 shifted to 2..7');
assert.equal(p.textClips[1].text, 'world', 'word retiming keeps only the surviving word');

// Overlapping cuts on a free track: cutFreeRanges removes the union once.
let q = {
  ...base(),
  audioClips: [{ id: 'au', mediaId: 'm', start: 0, in: 0, out: 10, speed: 1 }],
};
q = cutFreeRanges(q, 'audio', 'au', [{ start: 2, end: 4 }, { start: 3, end: 5 }]);
assert.equal(q.audioClips.length, 2, 'free-track cut splits into two pieces');
assert.equal(q.audioClips[0].out - q.audioClips[0].in, 2, 'first audio piece is 2 s');
assert.equal(q.audioClips[1].start, 2, 'second audio piece shifts by exactly 3 s');
assert.equal(q.audioClips[1].out - q.audioClips[1].in, 5, 'second audio piece is 5 s');

// moveRanges with overlapping ranges: the moved block length is the union.
let m = moveRanges(base([mk('a', 5), mk('b', 5), mk('c', 5)]), [{ start: 2, end: 4 }, { start: 3, end: 5 }], 12);
assert.equal(projectDuration(m), 15, 'move keeps the total duration');
const movedPieces = m.videoClips.filter((c) => /-m\d+$/.test(c.id));
assert.equal(movedPieces.length, 1, 'moved block is one piece (the [2,5] union sits inside clip a)');
const movedLen = movedPieces.reduce((n, c) => n + (c.out - c.in), 0);
assert.equal(movedLen, 3, 'moved block is exactly the 3 s union');

console.log('ALL PASS');
