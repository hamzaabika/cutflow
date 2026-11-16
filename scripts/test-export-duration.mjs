// Duration truth: exportDuration() (what the Export dialog shows) must equal
// buildExportArgs' total (what FFmpeg progress divides by) on every fixture —
// plain clips, gaps, transitions with overlap, speed != 1, image clips, and a
// clip whose media is missing (the case that actually diverged: the encoder
// drops it, the dialog used to keep counting it).
// NOTE (P0-01): the fixtures use REAL files. buildExportArgs drops clips whose
// file is gone from disk (missing-media guard), so the old fake paths
// (/x/a.mp4 …) made every fixture throw. A clip whose media ENTRY is absent
// is still dropped by both sides (see the 'missing media' fixture); a clip
// whose entry exists but whose FILE is gone is dropped by the encoder only —
// the dialog cannot stat files, so that residual divergence is a known
// follow-up (export preflight), covered by test-missing-media.mjs instead.
// Usage: node scripts/test-export-duration.mjs
import assert from 'assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { exportDuration, projectDuration } from '../src/store.js';

const require = createRequire(import.meta.url);
const { buildExportArgs, ffmpegPath } = require('../electron/ffmpeg.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-export-duration-'));
const vidA = path.join(tmp, 'a.mp4');
const vidB = path.join(tmp, 'b.mp4');
const imgP = path.join(tmp, 'p.png');
execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-ar', '44100', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vidA]);
execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vidB]);
execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=800x800:rate=1:duration=1', '-frames:v', '1', imgP]);

const media = [
  { id: 'v1', path: vidA, type: 'video', duration: 30, hasAudio: true, width: 1280, height: 720 },
  { id: 'v2', path: vidB, type: 'video', duration: 30, hasAudio: false, width: 1280, height: 720 },
  { id: 'im', path: imgP, type: 'image', duration: 0, hasAudio: false, width: 800, height: 800 },
];
const clip = (patch) => ({ volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1, ...patch });
const proj = (videoClips) => ({
  width: 1280, height: 720, fps: 30, background: '#000000', media,
  videoClips, overlayClips: [], textClips: [], audioClips: [],
});
const cases = {
  'plain clips': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 2 }), clip({ id: 'b', mediaId: 'v2', in: 0, out: 3 })]),
  'gap between clips': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 2 }), { id: 'g', gap: true, in: 0, out: 1.5, speed: 1 }, clip({ id: 'b', mediaId: 'v2', in: 0, out: 2 })]),
  'transition overlap': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 4 }), clip({ id: 'b', mediaId: 'v2', in: 0, out: 4, transition: { type: 'fade', duration: 1 } })]),
  'transition clamped to half a clip': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 4 }), clip({ id: 'b', mediaId: 'v2', in: 0, out: 4, transition: { type: 'fade', duration: 5 } })]),
  'speeds differ from 1': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 6, speed: 2 }), clip({ id: 'b', mediaId: 'v2', in: 0, out: 2, speed: 0.5 })]),
  'image clip': proj([clip({ id: 'a', mediaId: 'im', in: 0, out: 4 }), clip({ id: 'b', mediaId: 'v1', in: 0, out: 2 })]),
  'trimmed + sped + transition': proj([clip({ id: 'a', mediaId: 'v1', in: 5, out: 11, speed: 1.5 }), clip({ id: 'b', mediaId: 'v2', in: 2, out: 5, speed: 1, transition: { type: 'fadeblack', duration: 0.6 } })]),
  'missing media clip is dropped by both': proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 2 }), clip({ id: 'x', mediaId: 'gone', in: 0, out: 3 }), clip({ id: 'b', mediaId: 'v2', in: 0, out: 2 })]),
};
for (const [name, p] of Object.entries(cases)) {
  const shown = exportDuration(p);
  const { total } = buildExportArgs(p, '/tmp/out.mp4');
  assert.ok(Math.abs(shown - total) < 1e-9, `${name}: dialog ${shown} != encoder total ${total}`);
  console.log(`  ${name}: ${shown}s == ${total}s`);
}
// P0-03: projectDuration must include sticker/effect clips (exportDuration stays video-only).
const pdCases = {
  'sticker past the video end': [{ ...proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 2 })]), stickerClips: [{ id: 's1', sticker: 'x.png', start: 10, duration: 2 }], effectClips: [] }, 12],
  'effect past the video end': [{ ...proj([clip({ id: 'a', mediaId: 'v1', in: 0, out: 2 })]), stickerClips: [], effectClips: [{ id: 'e1', fx: 'fx_blur', start: 5, duration: 4 }] }, 9],
  'sticker only, no video': [{ ...proj([]), stickerClips: [{ id: 's1', sticker: 'x.png', start: 3, duration: 2 }], effectClips: [] }, 5],
};
for (const [name, [p, want]] of Object.entries(pdCases)) {
  assert.equal(projectDuration(p), want, `${name}: projectDuration ${projectDuration(p)} != ${want}`);
  assert.equal(exportDuration(p), name.startsWith('sticker only') ? 0 : 2, `${name}: exportDuration must stay video-only`);
  console.log(`  ${name}: projectDuration ${want}s (exportDuration unchanged)`);
}
console.log('export-duration OK — dialog duration and encoder total agree on all fixtures');
