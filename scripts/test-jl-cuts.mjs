// P1-03 (FB-04): J-cuts / L-cuts + independent linked-audio trimming.
// The audio member of a linked pair carries audioTrim {lead, trail} in
// timeline seconds; its own start/in/out stay the authoritative window.
// The pair must survive split / trim / speed, and a direct audio trim is
// read back into lead/trail instead of moving the picture.
// Usage: node scripts/test-jl-cuts.mjs
import assert from 'node:assert/strict';

const store = await import('../src/store.js');
const { audioTrimOf, audioWindowForPair, cutRanges, historyReducer, linkedPairInfo, normalizeProject, splitLinked, videoLayout } = store;
const km = await import('../src/keymap.js');

const st = (p) => ({ past: [], present: p, future: [] });
const run = (p, a) => historyReducer(st(p), a).present;
const vid = (p, id) => p.videoClips.find((c) => c.id === id);
const aud = (p, id) => p.audioClips.find((c) => c.id === id);
const ovl = (p, id) => p.overlayClips.find((c) => c.id === id);

// Video pair behind a 2 s gap (so a lead has room): picture [2,12) source
// 2..12, audio in sync, media 30 s. Overlay pair at [5,15) source 3..13.
const scene = () => normalizeProject({
  media: [{ id: 'm', type: 'video', duration: 30, hasAudio: true }],
  videoClips: [
    { id: 'g', gap: true, in: 0, out: 2 },
    { id: 'v', mediaId: 'm', in: 2, out: 12, speed: 1, muted: true, linkId: 'L1' },
  ],
  audioClips: [
    { id: 'a', mediaId: 'm', start: 2, in: 2, out: 12, speed: 1, linkId: 'L1', linkOff: 0, linkInOff: 0 },
    { id: 'a2', mediaId: 'm', start: 5, in: 3, out: 13, speed: 1, linkId: 'L2', linkOff: 0, linkInOff: 0 },
  ],
  overlayClips: [{ id: 'o', mediaId: 'm', start: 5, in: 3, out: 13, speed: 1, linkId: 'L2' }],
});
const picStart = (p, id) => videoLayout(p.videoClips).find((l) => l.clip.id === id)?.start;

// --- setAudioTrim: window follows the trims, clamped to the source ------
let p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1.5, trail: 2 });
assert.deepEqual([aud(p, 'a').start, aud(p, 'a').in, aud(p, 'a').out], [0.5, 0.5, 14], 'lead 1.5 + trail 2 move the audio window');
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1.5, trail: 2 }, 'trims stored');
assert.deepEqual([vid(p, 'v').in, vid(p, 'v').out], [2, 12], 'the picture does not move');
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 99, trail: 99 });
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 2, trail: 18 }, 'lead clamps to the source before in (2 s); trail to the media end (18 s)');
assert.equal(aud(p, 'a').in, 0, 'clamped lead reveals source from 0');
assert.equal(aud(p, 'a').out, 30, 'clamped trail runs to the media end');
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 0, trail: 0 });
assert.equal(aud(p, 'a').audioTrim, undefined, 'resync clears the trim');

// --- picture trim: the audio follows, trims kept -------------------------
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 2 });
p = run(p, { type: 'trimClip', track: 'video', id: 'v', edge: 'left', delta: 1 });
assert.equal(picStart(p, 'v'), 3, 'left trim grows the preceding gap, so the picture starts 1 s later');
assert.deepEqual([vid(p, 'v').in, vid(p, 'v').out], [3, 12], 'picture trimmed');
assert.deepEqual([aud(p, 'a').start, aud(p, 'a').in, aud(p, 'a').out], [2, 2, 14], 'audio follows the trimmed picture with the trims kept');
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1, trail: 2 }, 'trims survive a picture trim');
p = run(p, { type: 'trimClip', track: 'video', id: 'v', edge: 'right', delta: 2 });
assert.deepEqual([aud(p, 'a').in, aud(p, 'a').out], [2, 12], 'right trim shortens the audio tail by the same 2 s, trail still 2 s past the new end');

// --- picture move (overlay pair): the audio follows ----------------------
p = run(scene(), { type: 'setAudioTrim', id: 'a2', lead: 1, trail: 1 });
p = run(p, { type: 'update', track: 'overlay', id: 'o', patch: { start: 8 } });
assert.deepEqual([aud(p, 'a2').start, aud(p, 'a2').in, aud(p, 'a2').out], [7, 2, 14], 'overlay move carries the audio with its trims');
assert.deepEqual(audioTrimOf(aud(p, 'a2')), { lead: 1, trail: 1 }, 'trims survive a picture move');

// --- direct audio trim: read back into lead/trail, picture untouched -----
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 1 });
p = run(p, { type: 'update', track: 'audio', id: 'a', patch: { start: 0.5, in: 0.5 } });
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1.5, trail: 1 }, 'dragging the audio left edge out grows the lead');
assert.deepEqual([vid(p, 'v').in, vid(p, 'v').out], [2, 12], 'the picture does not follow an audio trim');
p = run(p, { type: 'update', track: 'audio', id: 'a', patch: { out: 15 } });
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1.5, trail: 3 }, 'dragging the audio right edge out grows the trail');
p = run(p, { type: 'update', track: 'audio', id: 'a', patch: { start: 2, in: 2 } });
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 0, trail: 3 }, 'dragging the audio left edge back to sync clears the lead');

// --- audio slip: still propagates to the picture -------------------------
p = run(scene(), { type: 'update', track: 'audio', id: 'a', patch: { in: 4, out: 14 } });
assert.deepEqual([vid(p, 'v').in, vid(p, 'v').out], [4, 14], 'a slip (same window, new source) still moves the picture');

// --- speed: picture speed carries the audio; audio speed carries the picture
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 1 });
p = run(p, { type: 'update', track: 'video', id: 'v', patch: { speed: 2 } });
assert.equal(aud(p, 'a').speed, 2, 'picture speed propagates to the audio');
assert.deepEqual([aud(p, 'a').start, aud(p, 'a').in, aud(p, 'a').out], [1, 0, 14], 'audio window rebuilt at 2x with the trims kept (1 s lead = 2 source seconds at 2x)');
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1, trail: 1 }, 'trims survive a picture speed change');
p = run(scene(), { type: 'update', track: 'audio', id: 'a', patch: { speed: 2 } });
assert.equal(vid(p, 'v').speed, 2, 'audio speed propagates to the picture');
assert.deepEqual([aud(p, 'a').start, aud(p, 'a').in, aud(p, 'a').out], [2, 2, 12], 'audio window rebuilt from the sped-up picture');

// --- speed curve: trims use the edge rates -------------------------------
p = scene();
p = run(p, { type: 'update', track: 'video', id: 'v', patch: { speedCurve: { points: [{ t: 0, speed: 1 }, { t: 10, speed: 2 }] } } });
assert.equal(aud(p, 'a').speedCurve?.points?.length, 2, 'the curve propagates to the audio');
p = run(p, { type: 'setAudioTrim', id: 'a', lead: 1, trail: 1 });
assert.equal(aud(p, 'a').in, 1, 'lead source uses the start-edge rate (1x)');
assert.equal(aud(p, 'a').out, 14, 'trail source uses the end-edge rate (2x)');

// --- split inside the picture: trims split left {lead,0} / right {0,trail}
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 2 });
p = run(p, { type: 'split', track: 'video', id: 'v', t: 7, newId: 'v2' });
assert.equal(p.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1')).length, 2, 'the audio splits with the picture');
const left = aud(p, 'a');
const right = p.audioClips.find((c) => c.linkId && c.linkId.startsWith('L1') && c.id !== 'a');
assert.deepEqual([left.start, left.in, left.out], [1, 1, 7], 'left audio keeps the lead');
assert.deepEqual(audioTrimOf(left), { lead: 1, trail: 0 }, 'left pair keeps the lead only');
assert.deepEqual([right.start, right.in, right.out], [7, 7, 14], 'right audio keeps the trail');
assert.deepEqual(audioTrimOf(right), { lead: 0, trail: 2 }, 'right pair keeps the trail only');
assert.notEqual(left.linkId, right.linkId, 'the two pairs get distinct link ids');
assert.equal(vid(p, 'v2').linkId, right.linkId, 'right picture pairs with right audio');

// --- split the audio in the lead zone: right half keeps the link --------
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 2, trail: 1 });
p = run(p, { type: 'split', track: 'audio', id: 'a', t: 1, newId: 'aR' });
const aL = aud(p, 'a');
const aR = aud(p, 'aR');
assert.equal(aL.linkId, undefined, 'the pure-lead left piece becomes independent');
assert.equal(aR.linkId, 'L1', 'the right piece keeps the link');
assert.deepEqual(audioTrimOf(aR), { lead: 1, trail: 1 }, 'its lead shortens to the overlap (2 s -> 1 s)');
assert.equal(vid(p, 'v').linkId, 'L1', 'the picture keeps the link too');

// --- split the audio in the trail zone: left half keeps the link --------
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 3 });
p = run(p, { type: 'split', track: 'audio', id: 'a', t: 13, newId: 'aR' });
assert.equal(aud(p, 'a').linkId, 'L1', 'the left piece keeps the link');
assert.deepEqual(audioTrimOf(aud(p, 'a')), { lead: 1, trail: 1 }, 'its trail shortens to the overlap (3 s -> 1 s)');
assert.equal(aud(p, 'aR').linkId, undefined, 'the pure-trail right piece becomes independent');

// --- ripple cut with trims: repair re-derives trims per piece -----------
p = run(scene(), { type: 'setAudioTrim', id: 'a', lead: 1, trail: 1 });
p = run(p, { type: 'setProject', patch: { rippleMode: 'linked' }, transient: true });
p = run(p, { type: 'cutRanges', ranges: [{ start: 5, end: 7 }], rippleText: true });
assert.equal(p.audioClips.filter((c) => c.linkId && c.linkId.startsWith('L1')).length, 2, 'the pair is cut into two');
const first = p.audioClips.find((c) => c.linkId === 'L1');
const second = p.audioClips.find((c) => c.linkId && c.linkId !== 'L1');
assert.deepEqual(audioTrimOf(first), { lead: 1, trail: 0 }, 'first piece keeps the lead only');
assert.deepEqual(audioTrimOf(second), { lead: 0, trail: 1 }, 'second piece keeps the trail only');
// ...and the next picture move must NOT re-extend a cut edge (the
// double-count the repair used to have: linkOff absorbing the lead).
p = run(p, { type: 'update', track: 'overlay', id: 'o', patch: { start: 9 } });
const firstAfter = p.audioClips.find((c) => c.linkId === 'L1');
assert.equal(firstAfter.start, 1, 'first audio piece still starts 1 s before its picture after a later move');
assert.deepEqual([firstAfter.in, firstAfter.out], [1, 5], 'first audio window unchanged by the unrelated move');

// --- linkedPairInfo + sanitize -------------------------------------------
const info = linkedPairInfo(scene(), 'audio', aud(scene(), 'a'));
assert.equal(info.pic.id, 'v', 'info finds the picture from the audio side');
assert.equal(info.picStart, 2, 'info reports the picture start');
assert.equal(linkedPairInfo(scene(), 'audio', { id: 'x' }), null, 'unlinked clip has no pair info');
const dirty = normalizeProject({ audioClips: [{ id: 'z', mediaId: 'm', start: 0, in: 0, out: 1, linkId: 'L9', audioTrim: { lead: -2, trail: NaN } }] });
assert.equal(dirty.audioClips[0].audioTrim, undefined, 'a negative / non-finite trim does not survive load');

// --- keymap: Alt+J / Alt+L resolve ---------------------------------------
const keymap = km.resolveKeymap({});
assert.equal(km.actionForEvent(keymap, { key: 'j', code: 'KeyJ', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), 'jCutToPlayhead', 'Alt+J is the J-cut');
assert.equal(km.actionForEvent(keymap, { key: 'l', code: 'KeyL', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false }), 'lCutToPlayhead', 'Alt+L is the L-cut');
assert.equal(km.actionForEvent(keymap, { key: 'j', code: 'KeyJ', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), 'shuttleBack', 'bare J is still shuttle back');

console.log('ALL PASS');
