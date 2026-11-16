// P2-06 Smooth Cut: eligibility, punch recipe, A/B preview suppression, the
// frame-difference fallback check, the ESM/CJS blend mirror, and real exports
// (blend shortens the timeline by its overlap; fallback restores the hard cut;
// punch zooms the cut frame). Usage: node scripts/test-p2b-smoothcut.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, probe, ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');
const cjs = require('../electron/smoothcut.cjs');
const esm = await import('../src/smoothCut.js');
const { stateAt } = await import('../src/anim.js');
const { motionDataPinned } = await import('../src/track.js');

const W = 320;
const H = 180;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-smoothcut-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const clip = path.join(dir, 'take.mp4');
gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=6`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const red = path.join(dir, 'red.mp4');
const blu = path.join(dir, 'blu.mp4');
gen(['-f', 'lavfi', '-i', `color=c=0xC81E1E:size=${W}x${H}:rate=${FPS}:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', red]);
gen(['-f', 'lavfi', '-i', `color=c=0x1E1EC8:size=${W}x${H}:rate=${FPS}:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blu]);
const media = [{ id: 'take', path: clip, name: 'take.mp4', ...(await probe(clip)) }];
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const twoClips = (extra2 = {}) => ([
  { ...base, id: 'c1', mediaId: 'take', in: 0, out: 3 },
  { ...base, id: 'c2', mediaId: 'take', in: 3, out: 6, ...extra2 },
]);
const projectOf = (clips, extra = {}) => ({
  name: 'smoothcut', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
  videoClips: clips, overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [], ...extra,
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

// ---- 1) Pure logic (ESM) ----------------------------------------------------
{
  const clips = twoClips();
  const project = projectOf(clips);
  const pair = esm.smoothCutPair(project, clips[1]);
  assert.ok(pair && pair.prev.id === 'c1', 'same-source contiguous pair found');
  assert.equal(esm.smoothCutPair(project, clips[0]), null, 'first clip has no pair');
  const nonContig = [
    { ...base, id: 'c1', mediaId: 'take', in: 0, out: 3 },
    { ...base, id: 'c2', mediaId: 'take', in: 3.5, out: 6 },
  ];
  assert.equal(esm.smoothCutPair(projectOf(nonContig), nonContig[1]), null, 'non-contiguous source is not a pair');
  assert.equal(esm.smoothCutBlockReason(project, clips[1]), null, 'clean pair is punchable');
  assert.equal(esm.smoothCutBlockReason(projectOf(twoClips()), { ...clips[1], keyframes: { scale: [{ t: 3.05, v: 1.2 }] } }), 'has-keys', 'existing scale keys block the recipe');
  const res = esm.smoothCutPunchPatches(project, clips[1], 0.15);
  assert.ok(res.ok && res.patches.length === 2, 'punch recipe returns both sides');
  const [prevPatch, nextPatch] = res.patches;
  assert.ok(prevPatch.patch.keyframes.scale.every((k) => k.sc), 'prev keys are marked sc');
  assert.ok(nextPatch.patch.keyframes.scale.every((k) => k.sc), 'next keys are marked sc');
  // Rate independence: the same recipe on a 2 s and an 8 s clip gives the same
  // scale at the same normalised time into the punch.
  const atU = (clips2, u) => {
    const r = esm.smoothCutPunchPatches(projectOf(clips2), clips2[1], 0.2);
    const c2 = { ...clips2[1], ...r.patches[1].patch };
    return stateAt(c2, u * 0.2, 0.2).transform.scale;
  };
  const short = [{ ...base, id: 'c1', mediaId: 'take', in: 0, out: 2 }, { ...base, id: 'c2', mediaId: 'take', in: 2, out: 4 }];
  const long = [{ ...base, id: 'c1', mediaId: 'take', in: 0, out: 8 }, { ...base, id: 'c2', mediaId: 'take', in: 8, out: 16 }];
  assert.ok(Math.abs(atU(short, 0.5) - atU(long, 0.5)) < 1e-6, 'punch shape is duration-independent');
  assert.ok(Math.abs(atU(short, 0) - 1.06) < 1e-6 && Math.abs(atU(short, 1) - 1) < 1e-6, 'punch runs 1.06 -> 1.0 across the head');
  // A/B: skipping sc keys restores scale 1.0 at the cut.
  const c2punched = { ...short[1], ...esm.smoothCutPunchPatches(projectOf(short), short[1], 0.2).patches[1].patch };
  assert.ok(Math.abs(stateAt(c2punched, 0, 0.2).transform.scale - 1.06) < 1e-6, 'smooth preview punches in');
  assert.ok(Math.abs(stateAt(c2punched, 0, 0.2, { skipSmoothCut: true }).transform.scale - 1) < 1e-6, 'hard preview skips the recipe keys');
  // Strip removes only the recipe keys.
  const mixed = { ...c2punched, keyframes: { scale: [...c2punched.keyframes.scale, { t: 5, v: 1.5 }] } };
  const stripped = esm.stripSmoothCutKeys(mixed);
  assert.deepEqual(stripped.keyframes.scale, [{ t: 5, v: 1.5 }], 'strip keeps the user key');
  assert.equal(esm.stripSmoothCutKeys({ keyframes: { scale: [{ t: 5, v: 1.5 }] } }), null, 'strip is a no-op without recipe keys');
  // Preview-hard spans both sides of the cut.
  const projHard = projectOf([{ ...base, id: 'c1', mediaId: 'take', in: 0, out: 3 },
    { ...base, id: 'c2', mediaId: 'take', in: 3, out: 6, smoothCut: { mode: 'punch', preview: 'hard' } }]);
  assert.equal(esm.smoothCutPreviewHard(projHard, projHard.videoClips[0]), true, 'prev clip previews hard too');
  assert.equal(esm.smoothCutPreviewHard(projHard, projHard.videoClips[1]), true, 'next clip previews hard');
  // Blend duration + mirror.
  assert.equal(esm.smoothCutBlendDur(twoClips({ smoothCut: { mode: 'blend', dur: 0.12 } }), 1), 0.12, 'blend length');
  assert.equal(esm.smoothCutBlendDur(twoClips({ smoothCut: { mode: 'blend', dur: 0.12, fallback: 'large-motion' } }), 1), 0, 'fallback kills the blend');
  assert.equal(esm.smoothCutBlendDur(twoClips({ smoothCut: { mode: 'punch', dur: 0.15 } }), 1), 0, 'punch is not a blend');
  for (const clips2 of [twoClips({ smoothCut: { mode: 'blend', dur: 0.12 } }), twoClips({ smoothCut: { mode: 'blend', dur: 0.12, fallback: 'large-motion' } }), twoClips()]) {
    assert.equal(cjs.smoothCutBlendDur(clips2, 1), esm.smoothCutBlendDur(clips2, 1), 'CJS mirror agrees with the ESM');
  }
}

// ---- 2) The frame-difference check -----------------------------------------
{
  const tmp = path.join(dir, 'check');
  const same = await cjs.checkCut(ffmpegPath, { prevPath: clip, nextPath: clip, prevAt: 2, nextAt: 2, tmpDir: tmp });
  assert.ok(same.psnr === Infinity || same.psnr > 40, `identical frames score high (psnr=${same.psnr})`);
  assert.equal(same.fallback, null, 'identical frames never fall back');
  const diff = await cjs.checkCut(ffmpegPath, { prevPath: red, nextPath: blu, prevAt: 1, nextAt: 1, tmpDir: tmp });
  assert.ok(diff.psnr < 24, `red vs blue scores low (psnr=${diff.psnr})`);
  assert.equal(diff.fallback, 'large-motion', 'different pictures fall back to a hard cut');
}

// ---- 3) Real exports --------------------------------------------------------
const runOne = async (tag, clips, extra = {}) => {
  const project = projectOf(clips, extra);
  const out = path.join(dir, `out-${tag}.mp4`);
  await runExport(project, out, null).promise;
  return out;
};
{
  // Hard cut baseline: 6 s in, 6 s out.
  const hard = await runOne('hard', twoClips());
  assert.ok(Math.abs((await probe(hard)).duration - 6) < 0.1, `hard cut keeps 6 s (${(await probe(hard)).duration})`);
  // Blend: the 0.12 s overlap shortens the timeline.
  const blend = await runOne('blend', twoClips({ smoothCut: { mode: 'blend', dur: 0.12 } }));
  assert.ok(Math.abs((await probe(blend)).duration - 5.88) < 0.1, `blend shortens by its overlap (${(await probe(blend)).duration})`);
  // Blend with the fallback set: back to a hard cut.
  const fb = await runOne('fallback', twoClips({ smoothCut: { mode: 'blend', dur: 0.12, fallback: 'large-motion' } }));
  assert.ok(Math.abs((await probe(fb)).duration - 6) < 0.1, `fallback restores the hard cut (${(await probe(fb)).duration})`);
  // The mid-junction frame is a true mix, not a step: in the blend export it
  // sits between the two sides, while the hard export's frame at the same
  // timestamp is pure A-side.
  const mid = (file) => decodeFrames(file, 2.94, 0.033)[0];
  const post = (file) => decodeFrames(file, 3.06, 0.033)[0];
  assert.ok(meanDiff(mid(blend), mid(hard)) > 1.5, `blend changes the junction frame (${meanDiff(mid(blend), mid(hard)).toFixed(1)})`);
  assert.ok(meanDiff(mid(blend), post(hard)) < meanDiff(mid(hard), post(hard)), 'blend mid-frame leans toward the B side');
  // Punch: same duration, but the cut frame is zoomed — it differs from the
  // hard cut's frame at the same timestamp.
  const clips = twoClips();
  const res = esm.smoothCutPunchPatches(projectOf(clips), clips[1], 0.15);
  const punched = [ { ...clips[0], ...res.patches[0].patch }, { ...clips[1], ...res.patches[1].patch, smoothCut: { mode: 'punch', dur: 0.15, preview: 'smooth' } } ];
  const proj = projectOf(punched, { motion: motionDataPinned(projectOf(punched)) });
  const out = path.join(dir, 'out-punch.mp4');
  await runExport(proj, out, null).promise;
  assert.ok(Math.abs((await probe(out)).duration - 6) < 0.1, 'punch keeps the duration');
  const d = meanDiff(decodeFrames(out, 3.0, 0.033)[0], decodeFrames(hard, 3.0, 0.033)[0]);
  assert.ok(d > 2, `punch visibly zooms the cut frame (mean diff ${d.toFixed(1)})`);
  // The blend path leaves the graph alone when a real transition is set.
  const args = buildExportArgs(projectOf([
    { ...base, id: 'c1', mediaId: 'take', in: 0, out: 3 },
    { ...base, id: 'c2', mediaId: 'take', in: 3, out: 6, transition: { type: 'fade', duration: 0.5 }, smoothCut: { mode: 'blend', dur: 0.12 } },
  ]), path.join(dir, 'x.mp4'));
  assert.ok(JSON.stringify(args).includes('xfade=transition=fade'), 'a real transition wins over the blend');
}
console.log('P2-06 Smooth Cut OK');
