// P1-02 (FB-03): linked / unlinked ripple modes. One cutRanges dispatch is
// one undo step in every mode; the modes differ in what ripples:
//   main   — main track only (captions only when the caller asks); linked
//            partners are still rebuilt piece-for-piece so the pair stays
//            in sync (FB-24 / P1-33 — a whole partner left behind would
//            desync by exactly the removed time)
//   linked — + captions + the audio/overlay partners linked to cut clips
//   all    — + every unlocked free-track clip; locked clips stay put
// The acceptance scene: a speech-retake cut with 3 synced overlays,
// 2 captions, audio ducking, an effect region, locked music and linked
// source audio. Usage: node scripts/test-ripple-modes.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanVoiceDuckSpans } = require('../electron/audiofx.cjs');
const store = await import('../src/store.js');
const { cutRanges, historyReducer, normalizeProject, videoLayout } = store;

const vmk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const amk = (id, start, len, extra = {}) => ({ id, mediaId: 'm', start, in: 0, out: len, speed: 1, ...extra });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}`).join(' ');

// Speech-retake scene: 10 s main clip with linked source audio + Clean
// Voice ducking, 3 synced overlays, 2 captions, an effect region, and
// music on a LOCKED audio layer.
const scene = () => {
  const p = {
    ...normalizeProject({}),
    media: [{ id: 'm', type: 'video', duration: 30, hasAudio: true }],
    videoClips: [vmk('v', 10, { linkId: 'L1', muted: true })],
    audioClips: [
      amk('src', 0, 10, { linkId: 'L1', linkOff: 0, linkInOff: 0, cleanVoice: { on: true, steps: { duck: true } } }),
      amk('music', 0, 10, { layer: 1 }),
    ],
    overlayClips: [vmk('o1', 2, { start: 1 }), vmk('o2', 2, { start: 4 }), vmk('o3', 2, { start: 7 })],
    textClips: [
      { id: 't1', start: 0, duration: 5, text: 'first half' },
      { id: 't2', start: 5, duration: 5, text: 'second half' },
    ],
    effectClips: [{ id: 'e1', kind: 'fx', fx: 'fade', start: 2, duration: 6 }],
    layerState: { 'audio:1': { locked: true } },
  };
  return p;
};
const vStart = (p) => (id) => { const l = videoLayout(p.videoClips).find((x) => x.clip.id === id); return l ? l.start : NaN; };
const duckSpans = (p) => cleanVoiceDuckSpans(p.videoClips, p.audioClips, vStart(p));

// --- main: only the picture moves; captions stay unless asked ------------
let p = cutRanges(scene(), [{ start: 3, end: 5 }], { rippleMode: 'main' });
assert.equal(layout(p), 'v@0-3 v-c1@3-8', 'main: picture closes up');
assert.equal(p.textClips[0].start, 0, 'main: captions do not move without rippleText');
assert.equal(p.audioClips.find((c) => c.id === 'src').start, 0, 'main: linked audio is not cut by the ripple itself');
assert.equal(p.overlayClips[0].start, 1, 'main: overlays do not move');
assert.equal(p.effectClips[0].start, 2, 'main: effect region does not move');

// --- linked: captions + the linked pair ripple; overlays do not ----------
p = cutRanges(scene(), [{ start: 3, end: 5 }], { rippleMode: 'linked' });
assert.equal(layout(p), 'v@0-3 v-c1@3-8', 'linked: picture closes up');
assert.equal(p.textClips.length, 2, 'linked: captions ripple (t1 loses its cut tail, t2 shifts)');
assert.deepEqual(p.textClips.map((c) => [c.id, c.start, c.duration]), [
  ['t1', 0, 3], ['t2', 3, 5],
], 'linked: captions ripple with the picture');
const srcPieces = p.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1'));
assert.equal(srcPieces.length, 2, 'linked: the source audio is cut into matching pieces');
assert.deepEqual(srcPieces.map((c) => [c.start, c.in, c.out]), [[0, 0, 3], [3, 5, 10]], 'linked: audio pieces keep the picture source windows');
assert.notEqual(srcPieces[0].linkId, srcPieces[1].linkId, 'linked: the two pairs get distinct link ids');
assert.equal(srcPieces[0].linkOff, 0, 'linked: left pair offset recomputed');
assert.equal(srcPieces[1].linkOff, 0, 'linked: right pair offset recomputed');
assert.equal(srcPieces[1].linkInOff, 0, 'linked: right pair source offset recomputed');
assert.equal(p.overlayClips[0].start, 1, 'linked: unlinked overlays do not move');
assert.equal(p.effectClips[0].start, 2, 'linked: effect region does not move');
assert.equal(p.audioClips.find((c) => c.id === 'music').start, 0, 'linked: locked music does not move');
assert.deepEqual(duckSpans(p).map((s) => [s.start, s.end]), [[0, 3], [3, 8]], 'linked: ducking spans follow the cut picture');

// --- all: everything unlocked ripples; locked music stays ----------------
p = cutRanges(scene(), [{ start: 3, end: 5 }], { rippleMode: 'all' });
assert.equal(layout(p), 'v@0-3 v-c1@3-8', 'all: picture closes up');
assert.deepEqual(p.overlayClips.map((c) => [c.id, c.start]), [['o1', 1], ['o2', 3], ['o3', 5]], 'all: overlays ripple (o2 straddles the cut and is cut too)');
assert.equal(p.overlayClips.find((c) => c.id === 'o2').out - p.overlayClips.find((c) => c.id === 'o2').in, 1, 'all: straddling overlay loses the cut second');
assert.deepEqual(p.effectClips.map((c) => [c.id, c.start, c.duration]), [['e1', 2, 1], ['e1-c1', 3, 3]], 'all: effect region is cut into two pieces and shifted');
assert.equal(p.audioClips.find((c) => c.id === 'music').start, 0, 'all: locked music stays exactly where it was');
assert.equal(p.audioClips.find((c) => c.id === 'music').in, 0, 'all: locked music source window untouched');
assert.equal(p.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1')).length, 2, 'all: linked audio still pairs up');
assert.deepEqual(duckSpans(p).map((s) => [s.start, s.end]), [[0, 3], [3, 8]], 'all: ducking spans follow the cut picture');

// --- one undo transaction --------------------------------------------------
let st = { past: [], present: scene(), future: [] };
st = historyReducer(st, { type: 'setProject', patch: { rippleMode: 'all' }, transient: true });
assert.equal(st.past.length, 0, 'mode switch is not an undo step');
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 3, end: 5 }], rippleText: true });
assert.equal(st.past.length, 1, 'the ripple cut is exactly one undo step');
assert.equal(st.present.videoClips.length, 2, 'cut landed');
st = historyReducer(st, { type: 'undo' });
assert.equal(st.present.videoClips.length, 1, 'undo restores the whole scene at once');
assert.equal(st.present.overlayClips.length, 3, 'undo restores the overlays too');

// --- main mode through historyReducer: the linked pair stays in sync -----
// cutRanges rebuilds the linked partner piece-for-piece (FB-24 / P1-33)
// even in main mode: the cut applies to the main track only, but a linked
// pair left whole would desync by exactly the removed time, and P1-02's
// acceptance requires everything to stay in sync under the chosen mode —
// as does P1-33 ("linked tracks preserved" on AI cuts, which dispatch
// cutRanges with the project default). An earlier form of this test pinned
// the audio untouched at [0,0,10]; that left the pair 2 s out of sync.
// historyReducer still skips syncLinked for main-mode cutRanges: the
// rebuild already paired the pieces, so there is nothing to repair.
st = { past: [], present: { ...scene(), rippleMode: 'main' }, future: [] };
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 3, end: 5 }], rippleText: false });
assert.equal(layout(st.present), 'v@0-3 v-c1@3-8', 'main via reducer: picture closes up');
assert.deepEqual(st.present.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1')).map((c) => [c.start, c.in, c.out]),
  [[0, 0, 3], [3, 5, 10]], 'main via reducer: linked audio is rebuilt piece-for-piece, pair stays in sync');
assert.deepEqual(st.present.videoClips.map((c) => c.linkId), ['L1', 'L1-c1'], 'main via reducer: video pieces carry distinct linkIds');
// ... and linked mode through the same reducer path still repairs.
st = { past: [], present: { ...scene(), rippleMode: 'linked' }, future: [] };
st = historyReducer(st, { type: 'cutRanges', ranges: [{ start: 3, end: 5 }], rippleText: true });
assert.deepEqual(st.present.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1')).map((c) => [c.start, c.in, c.out]),
  [[0, 0, 3], [3, 5, 10]], 'linked via reducer: audio pieces still pair up after syncLinked');

console.log('ALL PASS');
