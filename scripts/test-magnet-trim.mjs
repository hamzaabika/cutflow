// Magnet-on trim behaviour (P1-05). The duration-based left-trim branch was
// fixed by P0-02 (b937c6d); this suite pins the correct behaviour so it cannot
// regress, and probes every trim branch with the magnet on.
// Usage: node scripts/test-magnet-trim.mjs
import assert from 'node:assert/strict';
import { normalizeProject, trimClip } from '../src/store.js';

const magnetOn = { video: true, overlay: true, audio: true, text: true };
const base = () => ({
  ...normalizeProject({}),
  magnet: magnetOn,
  media: [{ id: 'v', type: 'video', duration: 10, hasAudio: true }],
  videoClips: [{ id: 'v1', mediaId: 'v', in: 0, out: 5, speed: 1, volume: 1, muted: false, transition: null }],
  audioClips: [
    { id: 'a1', mediaId: 'v', start: 2, in: 0, out: 5, speed: 1, volume: 1 },
    { id: 'a2', mediaId: 'v', start: 7, in: 0, out: 3, speed: 1, volume: 1 },
  ],
  textClips: [
    { id: 't1', text: 'one', start: 2, duration: 3, y: 0.5 },
    { id: 't2', text: 'two', start: 5, duration: 2, y: 0.5 },
  ],
  stickerClips: [{ id: 's1', sticker: 'star', name: 'Star', start: 1, duration: 4 }],
});

// The spec's probe: text clip {start:2, duration:3} left-trimmed by 1 s.
let p = trimClip(base(), { track: 'text', id: 't1', edge: 'left', delta: 1 });
let t1 = p.textClips.find((c) => c.id === 't1');
assert.deepEqual([t1.start, t1.duration], [3, 2], 'left trim must move start, keep end');
assert.equal(p.textClips.find((c) => c.id === 't2').start, 5, 'follower at the preserved end must not move');

// Right trim shortens from the end and pulls the follower left (magnet).
p = trimClip(base(), { track: 'text', id: 't1', edge: 'right', delta: 1 });
t1 = p.textClips.find((c) => c.id === 't1');
assert.deepEqual([t1.start, t1.duration], [2, 2]);
assert.equal(p.textClips.find((c) => c.id === 't2').start, 4, 'right trim must ripple the follower left');

// Left trim past the clip start clamps at 0 (negative delta extends).
p = trimClip(base(), { track: 'text', id: 't1', edge: 'left', delta: -5 });
t1 = p.textClips.find((c) => c.id === 't1');
assert.deepEqual([t1.start, t1.duration], [0, 5]);

// Sticker clips are duration-based too: left trim moves start, keeps end.
p = trimClip(base(), { track: 'sticker', id: 's1', edge: 'left', delta: 1 });
const s1 = p.stickerClips.find((c) => c.id === 's1');
assert.deepEqual([s1.start, s1.duration], [2, 3]);

// Audio left trim moves the source window; the follower closes the freed tail.
p = trimClip(base(), { track: 'audio', id: 'a1', edge: 'left', delta: 1 });
const a1 = p.audioClips.find((c) => c.id === 'a1');
assert.deepEqual([a1.in, a1.out], [1, 5]);
assert.equal(p.audioClips.find((c) => c.id === 'a2').start, 6, 'audio follower must close the freed tail');

// Main-track left trim moves the source window (position is derived from order).
p = trimClip(base(), { track: 'video', id: 'v1', edge: 'left', delta: 1 });
assert.equal(p.videoClips.find((c) => c.id === 'v1').in, 1);
assert.equal(p.videoClips.filter((c) => !c.gap).length, 1);

console.log('MAGNET TRIM OK');
