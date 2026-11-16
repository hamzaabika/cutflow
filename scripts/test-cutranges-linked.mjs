// Linked-track preservation on AI cuts (FB-24 / P1-33): cutRanges used to
// cut the picture and leave a detached-audio partner whole — the pair
// desynced by exactly the removed time, and every video piece claimed the
// same linkId. Now the partner is rebuilt piece for piece from its
// picture's new pieces (same start + linkOff, same source window +
// linkInOff), downstream linked pairs ripple with the picture, a picture
// cut away entirely takes its audio with it, and unlinked audio is
// untouched. One dispatch, one undo step.
// Usage: node scripts/test-cutranges-linked.mjs
import assert from 'node:assert/strict';
import { emptyProject, historyReducer, videoLayout } from '../src/store.js';

const run = (p, a) => historyReducer({ past: [], present: p, future: [] }, a).present;
const vid = (id, vin, vout, extra = {}) => ({
  id, mediaId: 'm1', in: vin, out: vout, speed: 1, volume: 1, muted: true,
  filter: 'none', adjust: {}, effects: [], transition: null, ...extra,
});
const aud = (id, start, ain, aout, extra = {}) => ({
  id, mediaId: 'm1', start, in: ain, out: aout, speed: 1, volume: 1, ...extra,
});
const layout = (p) => videoLayout(p.videoClips).map((l) => ({ id: l.clip.id, start: +l.start.toFixed(3), end: +l.end.toFixed(3) }));

function linkedProject() {
  const p = emptyProject();
  return {
    ...p,
    media: [{ id: 'm1', path: '/x/talk.mp4', type: 'video', duration: 40, width: 1280, height: 720, hasAudio: true }],
    // v1 0-20 (linked to a1) then v2 20-40 (linked to a2): a middle cut
    // must rebuild a1 AND shift v2 + a2 earlier by the removed time.
    videoClips: [vid('v1', 0, 20, { linkId: 'L1' }), vid('v2', 20, 40, { linkId: 'L2' })],
    audioClips: [
      aud('a1', 0, 0, 20, { linkId: 'L1', linkOff: 0, linkInOff: 0 }),
      aud('a2', 20, 20, 40, { linkId: 'L2', linkOff: 0, linkInOff: 0 }),
      aud('a9', 5, 0, 10, {}), // unlinked music bed: must not move
    ],
  };
}

// --- a middle cut rebuilds the partner piece for piece ---
let p = linkedProject();
p = run(p, { type: 'cutRanges', ranges: [{ start: 5, end: 15 }], rippleText: true });
assert.deepEqual(layout(p), [
  { id: 'v1', start: 0, end: 5 }, { id: 'v1-c1', start: 5, end: 10 }, { id: 'v2', start: 10, end: 30 },
], 'picture ripples: 10 s removed, v2 lands at 10');
const a1 = p.audioClips.filter((c) => c.id === 'a1' || c.id === 'a1-c1').sort((x, y) => x.start - y.start);
assert.equal(a1.length, 2, 'the linked partner is cut into the same two pieces');
assert.deepEqual(
  a1.map((c) => ({ id: c.id, start: c.start, in: c.in, out: c.out, linkId: c.linkId })),
  [
    { id: 'a1', start: 0, in: 0, out: 5, linkId: 'L1' },
    { id: 'a1-c1', start: 5, in: 15, out: 20, linkId: 'L1-c1' },
  ],
  'audio pieces mirror the picture pieces (start + linkOff, window + linkInOff)',
);
const v1 = p.videoClips.filter((c) => c.id === 'v1' || c.id === 'v1-c1');
assert.deepEqual(v1.map((c) => c.linkId), ['L1', 'L1-c1'], 'video pieces carry distinct linkIds matching their audio');
const a2 = p.audioClips.find((c) => c.id === 'a2');
assert.equal(a2.start, 10, 'the downstream linked pair ripples with the picture (20 -> 10)');
assert.equal(a2.in, 20, 'its source window is unchanged');
const a9 = p.audioClips.find((c) => c.id === 'a9');
assert.deepEqual([a9.start, a9.in, a9.out], [5, 0, 10], 'unlinked audio is untouched');
const totalAudio = (list) => list.reduce((n, c) => n + (c.out - c.in), 0);
assert.equal(totalAudio(p.audioClips.filter((c) => c.linkId)), 30, 'linked audio keeps 30 s of source (40 - 10 removed)');
assert.equal(totalAudio(p.audioClips.filter((c) => !c.linkId)), 10, 'unlinked audio keeps its 10 s');

// --- linkInOff: a detached pair whose audio window is offset from the picture ---
p = linkedProject();
p.videoClips = [vid('v1', 1, 5, { linkId: 'L' })];
p.audioClips = [aud('a1', 0, 0, 4, { linkId: 'L', linkOff: 0, linkInOff: -1 })];
p = run(p, { type: 'cutRanges', ranges: [{ start: 1, end: 2 }], rippleText: true });
const off = p.audioClips.filter((c) => c.id === 'a1' || c.id === 'a1-c1').sort((x, y) => x.start - y.start);
assert.equal(off.length, 2, 'the offset partner is cut into two pieces');
assert.deepEqual(
  off.map((c) => [c.start, c.in, c.out]),
  [[0, 0, 1], [1, 2, 4]],
  'offset windows follow the picture (in = video in + linkInOff)',
);

// --- a picture cut away entirely takes its audio with it ---
p = linkedProject();
p = run(p, { type: 'cutRanges', ranges: [{ start: 0, end: 20 }], rippleText: true });
assert.equal(p.videoClips.filter((c) => c.id.startsWith('v1')).length, 0, 'v1 is gone');
assert.equal(p.audioClips.filter((c) => c.id.startsWith('a1')).length, 0, 'its audio goes with it');
assert.equal(p.audioClips.find((c) => c.id === 'a2').start, 0, 'v2/a2 ripple to 0');

// --- no linkIds anywhere: cutRanges behaves exactly as before ---
p = linkedProject();
delete p.videoClips[0].linkId; delete p.videoClips[1].linkId;
p.audioClips = [aud('a9', 5, 0, 10, {})];
p = run(p, { type: 'cutRanges', ranges: [{ start: 5, end: 15 }], rippleText: true });
assert.deepEqual(layout(p), [
  { id: 'v1', start: 0, end: 5 }, { id: 'v1-c1', start: 5, end: 10 }, { id: 'v2', start: 10, end: 30 },
], 'unlinked cuts are unchanged');
assert.deepEqual([p.audioClips[0].start, p.audioClips[0].in], [5, 0], 'unlinked audio still untouched');

console.log('PASS  test-cutranges-linked');
