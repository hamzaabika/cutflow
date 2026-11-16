// P2-07 Time interpolation: filter selection (sample / blend / flow, only for
// slowed video) and real slow-motion renders — sampling duplicates frames,
// blending interpolates between them, optical flow renders clean in-betweens.
// Usage: node scripts/test-p2b-interp.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, interpFilter, probe, ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');

const W = 160;
const H = 90;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-interp-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const src = path.join(dir, 'move.mp4');
gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
const media = [{ id: 'm', path: src, name: 'move.mp4', ...(await probe(src)) }];
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null };
const projectOf = (clip) => ({
  name: 'interp', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
  videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
});
const decodeFrames = (file, from, len) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  const size = W * H * 4; const frames = [];
  for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
  return frames;
};
const meanDiff = (f1, f2) => {
  let s = 0; const n = Math.min(f1.length, f2.length);
  for (let i = 0; i < n; i++) s += Math.abs(f1[i] - f2[i]);
  return s / n;
};

// ---- 1) Filter selection ----------------------------------------------------
{
  const vid = { type: 'video' };
  const img = { type: 'image' };
  assert.equal(interpFilter({ speed: 0.5 }, vid, 30), 'fps=30', 'sample is the fps filter');
  assert.equal(interpFilter({ speed: 0.5, interp: 'blend' }, vid, 30), 'minterpolate=fps=30:mi_mode=blend', 'blend mode');
  assert.match(interpFilter({ speed: 0.5, interp: 'flow' }, vid, 30), /minterpolate=fps=30:mi_mode=mci:me_mode=bidir/, 'flow mode');
  assert.equal(interpFilter({ speed: 0.5, interp: 'flow' }, img, 30), 'fps=30', 'stills never interpolate');
  assert.equal(interpFilter({ speed: 0.5, interp: 'blend', videoOverride: { file: 'x.mp4', start: 0, end: 1 } }, vid, 30), 'fps=30', 'baked overrides never interpolate');
  assert.equal(interpFilter({ speed: 1, interp: 'blend' }, vid, 30), 'fps=30', 'full speed has nothing to interpolate');
  assert.equal(interpFilter({ speed: 2, interp: 'flow' }, vid, 30), 'fps=30', 'faster footage has nothing to interpolate');
  assert.equal(interpFilter({ speed: 1, interp: 'blend', speedCurve: { points: [{ t: 0, speed: 1 }, { t: 1, speed: 0.25 }] } }, vid, 30),
    'minterpolate=fps=30:mi_mode=blend', 'a ramp that dips below 1x interpolates');
  assert.equal(interpFilter({ speed: 1, interp: 'flow' }, vid, 30), 'fps=30', 'unknown mode falls back to sampling');
  // The graph carries the filter for a slowed clip, and nothing for a normal one.
  const slowed = buildExportArgs(projectOf({ ...base, id: 'c1', mediaId: 'm', in: 0, out: 2, speed: 0.5, interp: 'blend' }), path.join(dir, 'x.mp4'));
  assert.ok(JSON.stringify(slowed.args).includes('minterpolate=fps=30:mi_mode=blend'), 'blend reaches the export graph');
  const normal = buildExportArgs(projectOf({ ...base, id: 'c1', mediaId: 'm', in: 0, out: 2, speed: 1, interp: 'blend' }), path.join(dir, 'x.mp4'));
  assert.ok(!JSON.stringify(normal.args).includes('minterpolate'), 'full-speed clip has no minterpolate');
}

// ---- 2) Real slow-motion renders (0.5x, 2 s source -> 4 s out) --------------
// Proof by distinct frames: sampling duplicates every source frame (about half
// the transitions change), while blend and flow generate a new frame at almost
// every output step. Absolute pixel thresholds would drown in x264 re-encode
// noise (~6 mean abs on testsrc2); counting transitions is noise-robust
// (duplicate frames differ by <= 0.32 in the probe).
const runOne = async (tag, interp) => {
  const out = path.join(dir, `out-${tag}.mp4`);
  await runExport(projectOf({ ...base, id: 'c1', mediaId: 'm', in: 0, out: 2, speed: 0.5, interp }), out, null).promise;
  return out;
};
const changedTransitions = (file) => {
  const frames = decodeFrames(file, 0, 4);
  let changes = 0;
  for (let k = 1; k < frames.length; k++) if (meanDiff(frames[k], frames[k - 1]) > 1.5) changes++;
  return { n: frames.length, changes };
};
const sample = await runOne('sample', 'sample');
const blend = await runOne('blend', 'blend');
const flow = await runOne('flow', 'flow');
for (const [tag, file] of [['sample', sample], ['blend', blend], ['flow', flow]]) {
  const meta = await probe(file);
  assert.ok(Math.abs(meta.duration - 4) < 0.15, `${tag}: 4 s out (${meta.duration})`);
}
const s = changedTransitions(sample);
const b = changedTransitions(blend);
const f = changedTransitions(flow);
assert.ok(s.n >= 115 && s.changes < 70, `sample duplicates frames (${s.changes}/${s.n - 1} transitions change)`);
assert.ok(b.changes > 100, `blend interpolates nearly every frame (${b.changes}/${b.n - 1} transitions change)`);
assert.ok(f.changes > 100, `flow interpolates nearly every frame (${f.changes}/${f.n - 1} transitions change)`);
console.log('P2-07 Time interpolation OK');
