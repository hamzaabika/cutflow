// P2-18 Motion presets (+ P2-25 Premium Movement Pack): normalised keyframe
// recipes are rate-independent (same transform at the same u on a 2 s clip and
// an 8 s clip) and never uncover the frame (scale >= 1, |x|,|y| <= (s-1)/2);
// presets strip/re-apply cleanly without touching user keys; motion blur
// reaches the export graph and the rendered frames.
// Usage: node scripts/test-p2b-motion.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stateAt, animById, previewState } from '../src/anim.js';
import { motionDataPinned } from '../src/track.js';
import {
  MOTION_PRESETS, PREMIUM_MOVEMENT_PACK, motionPresetById,
  applyMotionPreset, clearMotionPreset, stripPresetKeys, trackingLabelPatch,
} from '../src/fx/motionPresets.js';

const require = createRequire(import.meta.url);
const { buildExportArgs, probe, ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');

const mkClip = (len, extra = {}) => ({ id: 'c1', mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const atU = (clip, u) => {
  const len = clip.out - clip.in;
  const st = stateAt(clip, u * len, len);
  return st.transform;
};
const covers = (tr, where) => {
  const s = tr.scale;
  assert.ok(s >= 1 - 1e-9, `${where}: scale ${s} < 1`);
  assert.ok(Math.abs(tr.x) <= (s - 1) / 2 + 1e-6, `${where}: |x| ${tr.x} exceeds (s-1)/2 = ${(s - 1) / 2}`);
  assert.ok(Math.abs(tr.y) <= (s - 1) / 2 + 1e-6, `${where}: |y| ${tr.y} exceeds (s-1)/2 = ${(s - 1) / 2}`);
  assert.ok(s >= 1 / Math.cos((tr.rot * Math.PI) / 180) - 1e-6, `${where}: scale ${s} too small for rot ${tr.rot}deg`);
};

// ---- 1) Rate independence + coverage for every preset -----------------------
// Keyframe presets: the same transform at the same u on a 2 s clip and an
// 8 s clip. Combo presets (handheld): the same motion at the same ABSOLUTE
// time on any clip length — the shake does not stretch with the clip.
for (const p of MOTION_PRESETS) {
  const short = mkClip(2);
  const long = mkClip(8);
  const ps = applyMotionPreset(short, p.id);
  const pl = applyMotionPreset(long, p.id);
  assert.ok(ps && pl, `${p.id}: applies`);
  const cs = { ...short, ...ps };
  const cl = { ...long, ...pl };
  if (p.combo) {
    for (const lt of [0, 0.25, 0.5, 1, 1.5, 1.9]) {
      const a = stateAt(cs, lt, 2).transform;
      const b = stateAt(cl, lt, 8).transform;
      assert.ok(Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.rot - b.rot) < 1e-6,
        `${p.id}: lt=${lt} differs between 2 s and 8 s clips`);
      covers(a, `${p.id} lt=${lt}`);
    }
    continue;
  }
  for (let k = 0; k <= 20; k++) {
    const u = k / 20;
    const a = atU(cs, u);
    const b = atU(cl, u);
    assert.ok(Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.rot - b.rot) < 1e-6,
      `${p.id}: u=${u} differs between 2 s and 8 s clips`);
    covers(a, `${p.id} u=${u}`);
  }
  // The preset's own key times (u grid of the recipe) — the sharpest points.
  for (const keys of Object.values(p.keys)) for (const [u] of keys) covers(atU(cs, u), `${p.id} key u=${u}`);
}
// The handheld combo is registered and stays inside its coverage margin.
assert.ok(animById('combo', 'handheld'), 'handheld is in the Animation tab catalog');
{
  const st = previewState('combo', 'handheld', 0.5);
  assert.ok(st.s >= 1.03 - 1e-9 && Math.abs(st.x) <= 0.013 + 1e-9, `handheld preview state s=${st.s} x=${st.x}`);
}

// ---- 2) Strip / re-apply / clear never touches user keys --------------------
{
  const clip = mkClip(2, { keyframes: { scale: [{ t: 1, v: 1.5 }] } });
  const p1 = applyMotionPreset(clip, 'punch-in');
  const c1 = { ...clip, ...p1 };
  assert.equal(c1.keyframes.scale.length, 5, 'punch-in keys + the user key');
  const p2 = applyMotionPreset(c1, 'snap-zoom');
  const c2 = { ...c1, ...p2 };
  assert.ok(!c2.keyframes.scale.some((k) => Math.abs(k.t - 0.5) < 1e-4 || Math.abs(k.t - 1.5) < 1e-4), 'punch-in keys are gone');
  assert.ok(c2.keyframes.scale.some((k) => Math.abs(k.t - 1) < 1e-4 && k.v === 1.5), 'the user key survives');
  assert.equal(c2.motionPreset, 'snap-zoom');
  const p3 = applyMotionPreset(c2, 'handheld');
  const c3 = { ...c2, ...p3 };
  assert.equal(c3.anim.combo.type, 'handheld', 'handheld sets the combo');
  assert.ok(!c3.keyframes.scale.some((k) => Math.abs(k.t - 0.24) < 1e-4), 'snap-zoom keys are gone under handheld');
  const p4 = applyMotionPreset(c3, 'punch-in');
  const c4 = { ...c3, ...p4 };
  assert.ok(!c4.anim?.combo, 'a keyframe preset clears the combo');
  const gone = clearMotionPreset(c4);
  const c5 = { ...c4, ...gone };
  assert.equal(c5.motionPreset, null);
  assert.deepEqual(c5.keyframes.scale, [{ t: 1, v: 1.5 }], 'clearing leaves only the user key');
  assert.equal(stripPresetKeys({ keyframes: {} }, 'no-such-preset').scale, undefined, 'unknown preset strips nothing');
  assert.equal(applyMotionPreset(clip, 'no-such-preset'), null, 'unknown preset returns null');
}

// ---- 3) Premium Movement Pack grouping --------------------------------------
assert.deepEqual(PREMIUM_MOVEMENT_PACK.presets, ['whip-zoom', 'slow-drift', 'snap-focus']);
assert.ok(PREMIUM_MOVEMENT_PACK.presets.every((id) => motionPresetById(id).pack === 'premium-movement'));

// ---- 4) Tracking label -------------------------------------------------------
assert.deepEqual(trackingLabelPatch('track-1'), { pin: { to: 'track-1' }, animLoop: { id: 'float', speed: 1 } });

// ---- 5) Motion blur in the export graph and the rendered frames --------------
const W = 160;
const H = 90;
const FPS = 30;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-motion-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const src = path.join(dir, 'move.mp4');
gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
const media = [{ id: 'm', path: src, name: 'move.mp4', ...(await probe(src)) }];
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null };
const projectOf = (clip) => {
  const p = {
    name: 'motion', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
    videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  };
  // The export reads sampled motion curves from project.motion (the renderer
  // attaches motionDataPinned before exporting) — without it the clip takes
  // the plain path and no tmix can appear.
  p.motion = motionDataPinned(p);
  return p;
};
const decodeFrame = (file, from) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `trim=start=${from}:duration=0.033,setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
  return raw.subarray(0, W * H * 4);
};
const meanDiff = (f1, f2) => {
  let s = 0;
  for (let i = 0; i < f1.length; i++) s += Math.abs(f1[i] - f2[i]);
  return s / f1.length;
};
const clip = mkClip(2, base);
const patch = applyMotionPreset(clip, 'punch-in');
const withMotion = { ...clip, ...patch };
const blurred = { ...withMotion, motionBlur: true };
const argsBlur = buildExportArgs(projectOf(blurred), path.join(dir, 'b.mp4'));
assert.ok(JSON.stringify(argsBlur.args).includes('tmix=frames=3'), 'motionBlur adds tmix to the graph');
// The preset itself sets motionBlur, so the sharp control must turn it off.
const sharp = { ...withMotion, motionBlur: false };
const argsSharp = buildExportArgs(projectOf(sharp), path.join(dir, 's.mp4'));
assert.ok(!JSON.stringify(argsSharp.args).includes('tmix'), 'no tmix without the flag');
const outBlur = path.join(dir, 'out-blur.mp4');
const outSharp = path.join(dir, 'out-sharp.mp4');
await runExport(projectOf(blurred), outBlur, null).promise;
await runExport(projectOf(sharp), outSharp, null).promise;
for (const f of [outBlur, outSharp]) {
  const meta = await probe(f);
  assert.ok(Math.abs(meta.duration - 2) < 0.15, `motion export keeps 2 s (${meta.duration})`);
}
// Mid-punch the picture is moving and zooming, so the 3-frame blend must
// differ visibly from the sharp frame.
const d = meanDiff(decodeFrame(outBlur, 1.0), decodeFrame(outSharp, 1.0));
assert.ok(d > 1, `blurred frame differs from the sharp frame at the punch (mean diff ${d.toFixed(2)})`);
console.log('P2-18 Motion presets OK');
