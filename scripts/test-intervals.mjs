// Gap-build Stream E — TL-01 (normalize overlapping edit intervals) +
// TL-02 (opt-in linked ripple). Run: node scripts/test-intervals.mjs
import assert from 'node:assert/strict';
import { normalizeCutRanges, totalRemoved, cutBeforeFn, sameCoverage } from '../src/intervals.js';
import { cutRanges, cutFreeRanges, moveRanges, normalizeProject, projectDuration, videoLayout } from '../src/store.js';

// ---------- normalizeCutRanges ----------
assert.deepEqual(normalizeCutRanges([]), [], 'empty in, empty out');
assert.deepEqual(normalizeCutRanges([{ start: 5, end: 3 }]), [], 'inverted range dropped');
assert.deepEqual(normalizeCutRanges([{ start: 0, end: 0.005 }]), [], 'sliver dropped');
assert.deepEqual(
  normalizeCutRanges([{ start: 8, end: 10 }, { start: 0, end: 1 }, { start: 4, end: 5 }]),
  [{ start: 0, end: 1 }, { start: 4, end: 5 }, { start: 8, end: 10 }],
  'out-of-order ranges sort',
);
assert.deepEqual(
  normalizeCutRanges([{ start: 2, end: 6 }, { start: 4, end: 9 }, { start: 12, end: 14 }]),
  [{ start: 2, end: 9 }, { start: 12, end: 14 }],
  'overlapping ranges merge into one',
);
assert.deepEqual(
  normalizeCutRanges([{ start: 2, end: 6 }, { start: 6, end: 9 }]),
  [{ start: 2, end: 9 }],
  'touching ranges merge',
);
assert.deepEqual(normalizeCutRanges([{ start: -2, end: 3 }]), [{ start: 0, end: 3 }], 'negative start clips to 0');
assert.equal(totalRemoved([{ start: 2, end: 6 }, { start: 4, end: 9 }]), 7, 'overlap counted once in totalRemoved');
assert.equal(totalRemoved([{ start: 2, end: 6 }, { start: 4, end: 9 }]), 7, 'totalRemoved is stable');
const cb = cutBeforeFn([{ start: 2, end: 6 }, { start: 4, end: 9 }]);
assert.equal(cb(1), 0, 'cutBefore before any cut is 0');
assert.equal(cb(5), 3, 'cutBefore mid-overlap counts the union, not the sum');
assert.equal(cb(20), 7, 'cutBefore after all cuts is the union length');
assert.equal(sameCoverage([{ start: 2, end: 6 }, { start: 4, end: 9 }], [{ start: 2, end: 9 }]), true, 'sameCoverage sees through overlaps');
assert.equal(sameCoverage([{ start: 2, end: 6 }], [{ start: 2, end: 9 }]), false, 'sameCoverage rejects different coverage');

// ---------- TL-01: overlapping cuts no longer double-count ----------
// One 10 s clip; overlapping cuts [2,6] + [4,9] remove 7 s once (old code
// removed 4+5=9 s from the ripple shift while the pieces were union-correct).
const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const base = (extra = {}) => ({
  ...normalizeProject({}),
  media: [{ id: 'm', type: 'video', duration: 30 }],
  videoClips: [mk('a', 10)],
  textClips: [{ id: 't1', text: 'hello world', start: 0, duration: 10, words: [
    { text: 'hello', start: 0, end: 1 }, { text: 'world', start: 8, end: 9 },
  ] }],
  ...extra,
});
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}`).join(' ');
let p = cutRanges(base(), [{ start: 2, end: 6 }, { start: 4, end: 9 }], { rippleText: true });
assert.equal(projectDuration(p), 3, 'overlapping cuts remove the union (7 s), duration 10 -> 3');
assert.equal(layout(p), 'a@0-2 a-c1@2-3', 'pieces are the union survivors');
assert.equal(p.textClips.length, 2, 'text clip survives as two pieces (0-2 s and the 9-10 s tail)');
assert.equal(p.textClips[0].start, 0, 'text piece starts at 0');
assert.equal(p.textClips[0].duration, 2, 'text piece is the 0-2 s survivor');
assert.equal(p.textClips[1].start, 2, 'tail piece shifts earlier by the union (7 s), not the sum (9 s)');
assert.equal(p.textClips[1].duration, 1, 'tail piece is 1 s long');
assert.deepEqual(p.textClips[0].words.map((w) => w.text), ['hello'], 'the word inside the cuts is gone, the survivor keeps its word');

// moveRanges with overlapping ranges: blockLen counts the union once.
let m = moveRanges(base(), [{ start: 2, end: 6 }, { start: 4, end: 9 }], 0);
assert.equal(projectDuration(m), 10, 'moveRanges never changes total duration');
assert.equal(layout(m).startsWith('a-m'), true, 'the moved block lands at the front');

// cutFreeRanges normalizes too (single audio clip, overlapping cuts).
const af = { ...base(), audioClips: [{ id: 'au', mediaId: 'm', in: 0, out: 10, start: 0, speed: 1 }] };
const af2 = cutFreeRanges(af, 'audio', 'au', [{ start: 2, end: 6 }, { start: 4, end: 9 }]);
assert.equal(af2.audioClips.length, 2, 'audio clip splits into two surviving pieces');
assert.equal(af2.audioClips[1].start, 2, 'second piece shifts earlier by the union (7 s), not the sum (9 s)');

// ---------- TL-02: linked ripple is opt-in, default unchanged ----------
const withOverlay = () => base({
  overlayClips: [{ id: 'o1', mediaId: 'm', in: 0, out: 10, start: 5, speed: 1 }],
  audioClips: [{ id: 'au', mediaId: 'm', in: 0, out: 10, start: 0, speed: 1 }],
});
let dflt = cutRanges(withOverlay(), [{ start: 3, end: 5 }]);
assert.equal(dflt.overlayClips[0].start, 5, 'default (main-only) ripple leaves the overlay at its time');
assert.equal(dflt.audioClips[0].start, 0, 'default ripple leaves audio untouched');
let linked = cutRanges(withOverlay(), [{ start: 3, end: 5 }], { rippleLinked: true });
assert.equal(linked.overlayClips[0].start, 3, 'linked ripple shifts the overlay earlier by the cut');
assert.equal(linked.audioClips.length, 2, 'linked ripple cuts the audio clip at the range');
assert.equal(linked.audioClips[1].start, 3, 'linked audio survivor closes up');
assert.equal(linked.textClips[0].start, 0, 'linked ripple also carries the text clips');
// A free clip fully inside the cut disappears under linked ripple.
// (Fixture span [3.5, 4.5] sits wholly inside the [3, 5] cut — the
// original fixture had out: 2, i.e. span [3.5, 5.5], whose 5-5.5 s tail
// correctly survives any subtraction, so it never tested this.)
let gone = cutRanges(base({ overlayClips: [{ id: 'o1', mediaId: 'm', in: 0, out: 1, start: 3.5, speed: 1 }] }), [{ start: 3, end: 5 }], { rippleLinked: true });
assert.equal(gone.overlayClips.length, 0, 'overlay fully inside the cut is removed by linked ripple');
// Default rippleMode on a fresh project is 'main'.
assert.equal(normalizeProject({}).rippleMode, 'main', 'fresh projects default to main-only ripple');

console.log('test-intervals: PASS');
