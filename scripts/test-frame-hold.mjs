// P1-50 (FB-31): frame hold as a clip property. The hold freezes one frame
// inside a clip — [at, at+duration) shows the frame at `at`, the source span
// it replaces is never shown, the clip length does not change — in the
// preview (holdSourceOffsetAt) and in the export (pictureSource +
// clipAudioFilter: the sound skips the held span and is silent over it).
// Usage: node scripts/test-frame-hold.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sc = require('../electron/speedcurve.cjs');
const { ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');
const esm = await import('../src/speedCurve.js');
const store = await import('../src/store.js');
const { applyClipPatch, historyReducer, normalizeProject, videoLayout } = store;

const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| > ${tol}`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-hold-'));
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

// ---- 1. ESM <-> CJS parity for the hold helpers ---------------------------
const corpus = [
  { in: 0, out: 6, speed: 1, frameHold: { at: 2, duration: 2 } },
  { in: 1, out: 7, speed: 2, frameHold: { at: 1, duration: 1 } },
  { in: 0, out: 6, speed: 1, frameHold: { at: 0, duration: 6 } },
  { in: 0, out: 6, speed: 1, frameHold: { at: 5.9, duration: 2 } }, // out of range
  { in: 0, out: 6, speed: 1, speedCurve: { points: [{ t: 0, speed: 1 }, { t: 6, speed: 2 }] }, frameHold: { at: 1, duration: 1 } },
  { in: 0, out: 6, speed: 1 },
];
for (const clip of corpus) {
  assert.deepEqual(esm.validFrameHold(clip), sc.validFrameHold(clip), 'mirror validFrameHold');
  for (let lt = 0; lt <= 6; lt += 0.5) {
    approx(esm.holdSourceOffsetAt(clip, lt), sc.holdSourceOffsetAt(clip, lt), 1e-9, 'mirror holdSourceOffsetAt');
  }
  assert.deepEqual(esm.splitFrameHold(clip.frameHold, 3), sc.splitFrameHold(clip.frameHold, 3), 'mirror splitFrameHold');
  assert.deepEqual(esm.pieceFrameHold(clip.frameHold, 1, 4), sc.pieceFrameHold(clip.frameHold, 1, 4), 'mirror pieceFrameHold');
}
console.log('  mirror: hold helpers identical ESM <-> CJS');

// ---- 2. Hold map ------------------------------------------------------------
const held = { in: 0, out: 6, speed: 1, frameHold: { at: 2, duration: 2 } };
approx(esm.holdSourceOffsetAt(held, 1), 1, 1e-9, 'before the hold the map is plain');
approx(esm.holdSourceOffsetAt(held, 2.5), 2, 1e-9, 'inside the hold the source stays at the hold point');
approx(esm.holdSourceOffsetAt(held, 3.9), 2, 1e-9, 'still frozen at the end of the hold');
approx(esm.holdSourceOffsetAt(held, 4.5), 4.5, 1e-9, 'after the hold the source resumes past the skipped span');
const fast = { in: 0, out: 6, speed: 2, frameHold: { at: 1, duration: 1 } };
approx(esm.holdSourceOffsetAt(fast, 1.5), 2, 1e-9, '2x: frozen at source 2 inside the hold');
approx(esm.holdSourceOffsetAt(fast, 2.5), 5, 1e-9, '2x: source resumes at 5 after the hold');
assert.equal(esm.validFrameHold({ in: 0, out: 6, speed: 1, frameHold: { at: 5, duration: 2 } }), null, 'hold running past the end is invalid');
assert.equal(esm.validFrameHold({ in: 0, out: 6, speed: 1, frameHold: { at: -1, duration: 1 } }), null, 'negative hold point is invalid');

// ---- 3. Store: sanitize / split / trim / cut re-base the hold -------------
let c = applyClipPatch({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1 }, { frameHold: { at: 5, duration: 2 } });
assert.equal(c.frameHold, undefined, 'patch drops a hold that does not fit');
c = applyClipPatch({ id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1 }, { frameHold: { at: 2, duration: 2 } });
assert.deepEqual(c.frameHold, { at: 2, duration: 2 }, 'patch keeps a valid hold');
c = applyClipPatch(c, { frameHold: null });
assert.equal('frameHold' in c, false, 'clearing the hold removes the key');

const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const base = (clips) => ({ ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 60 }], videoClips: clips });
// Split before the hold: the right half keeps it, shifted.
let st = { past: [], present: base([mk('a', 6, { frameHold: { at: 2, duration: 2 } })]), future: [] };
st = historyReducer(st, { type: 'split', track: 'video', id: 'a', t: 1, newId: 'a2' });
let halves = st.present.videoClips;
assert.equal(halves[0].frameHold, undefined, 'left half (before the hold) has no hold');
assert.deepEqual(halves[1].frameHold, { at: 1, duration: 2 }, 'right half keeps the hold, shifted');
// Split through the hold: both halves drop it.
st = { past: [], present: base([mk('a', 6, { frameHold: { at: 2, duration: 2 } })]), future: [] };
st = historyReducer(st, { type: 'split', track: 'video', id: 'a', t: 3, newId: 'a2' });
halves = st.present.videoClips;
assert.equal(halves[0].frameHold, undefined, 'split through the hold drops it on the left');
assert.equal(halves[1].frameHold, undefined, 'split through the hold drops it on the right');
// Left trim shifts the hold point; a trim into the hold drops it.
st = { past: [], present: base([mk('a', 6, { frameHold: { at: 2, duration: 2 } })]), future: [] };
st = historyReducer(st, { type: 'trimClip', track: 'video', id: 'a', edge: 'left', delta: 1 });
assert.deepEqual(st.present.videoClips.find((x) => x.id === 'a').frameHold, { at: 1, duration: 2 }, 'left trim shifts the hold point');
st = { past: [], present: base([mk('a', 6, { frameHold: { at: 2, duration: 2 } })]), future: [] };
st = historyReducer(st, { type: 'trimClip', track: 'video', id: 'a', edge: 'left', delta: 3 });
assert.deepEqual(st.present.videoClips.find((x) => x.id === 'a').frameHold, { at: 0, duration: 1 }, 'trim into the hold clamps it to the surviving part');
st = { past: [], present: base([mk('a', 6, { frameHold: { at: 2, duration: 2 } })]), future: [] };
st = historyReducer(st, { type: 'trimClip', track: 'video', id: 'a', edge: 'left', delta: 4.5 });
assert.equal(st.present.videoClips.find((x) => x.id === 'a').frameHold, undefined, 'trim past the hold drops it');
// A cut range that removes the hold's piece drops the hold from the survivors.
const cut = store.cutRanges(base([mk('a', 10, { frameHold: { at: 2, duration: 2 } })]), [{ start: 1, end: 5 }]);
assert.ok(cut.videoClips.every((x) => !x.frameHold), 'cutting out the hold removes it from every piece');
const kept = store.cutRanges(base([mk('a', 10, { frameHold: { at: 6, duration: 2 } })]), [{ start: 1, end: 3 }]);
assert.deepEqual(kept.videoClips.find((x) => x.id === 'a-c1').frameHold, { at: 3, duration: 2 }, 'a surviving piece keeps its hold, shifted');

// ---- 4. Real export: the frame is held exactly -----------------------------
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const src = path.join(dir, 'src.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', src]);
const media = [{ id: 'm1', path: src, type: 'video', duration: 6, width: 320, height: 180, hasAudio: true, channels: 2 }];
const baseClip = { speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, transform: { scale: 1, x: 0, y: 0, rot: 0, uniform: true, scaleX: 1, scaleY: 1 }, opacity: 1 };
const project = {
  name: 'hold', ratio: '16:9', resolution: 720, width: 320, height: 180, fps: 30, background: '#101010', media,
  videoClips: [{ ...baseClip, id: 'a', mediaId: 'm1', in: 0, out: 6, frameHold: { at: 2, duration: 2 } }],
  overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
};
const frame = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 * 1024 * 1024 });
const diff = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]); return s / n; };
const out = path.join(dir, 'out.mp4');
const job = runExport(project, out, () => {});
await job.promise;
const fPre = frame(out, 1.0);
const fIn1 = frame(out, 2.5);
const fIn2 = frame(out, 3.5);
const fRef = frame(src, 2.0);
const fPost = frame(out, 4.5);
const fPostRef = frame(src, 4.5);
ok(diff(fIn1, fIn2) < 1.5, `held span is static (diff ${diff(fIn1, fIn2).toFixed(2)})`);
ok(diff(fIn1, fRef) < 6, `held frame matches the source frame at 2.0 s (diff ${diff(fIn1, fRef).toFixed(2)})`);
ok(diff(fPre, fIn1) > 4, `pre-hold motion differs from the held frame (diff ${diff(fPre, fIn1).toFixed(2)})`);
ok(diff(fPost, fIn1) > 4, `post-hold motion differs from the held frame (diff ${diff(fPost, fIn1).toFixed(2)})`);
ok(diff(fPost, fPostRef) < 6, `post-hold frame matches source 4.5 s (diff ${diff(fPost, fPostRef).toFixed(2)})`);
// Audio: tone before and after the hold, silence inside it.
const pcm = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', out, '-vn', '-f', 'f32le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 16 * 1024 * 1024 });
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
const rms = (a, b) => {
  const s0 = Math.floor(a * 8000), s1 = Math.floor(b * 8000);
  let s = 0; for (let i = s0; i < Math.min(s1, samples.length); i++) s += samples[i] * samples[i];
  return Math.sqrt(s / Math.max(1, Math.min(s1, samples.length) - s0));
};
ok(rms(0.5, 1.5) > 0.05, `tone sounds before the hold (rms ${rms(0.5, 1.5).toFixed(3)})`);
ok(rms(2.5, 3.5) < 0.005, `silence inside the hold (rms ${rms(2.5, 3.5).toFixed(4)})`);
ok(rms(4.5, 5.5) > 0.05, `tone sounds after the hold (rms ${rms(4.5, 5.5).toFixed(3)})`);

console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
