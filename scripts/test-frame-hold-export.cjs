// P1-50 frame hold — export verification: a held clip exports at the right
// length, and two frames sampled inside the hold window are pixel-identical
// (testsrc2 changes every frame, so any motion inside the window fails).
// Usage: TMPDIR=~/workspace/.tmp-battery node scripts/test-frame-hold-export.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const grab = (file, t, out) => {
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', out]);
  return out;
};
// PSNR between two stills: identical source frames re-encoded by x264 differ
// only by encoder noise (measured 58–69 dB), while genuinely different
// testsrc2 frames sit near 14 dB — so byte equality is the wrong test here.
const psnr = (a, b) => {
  const { spawnSync } = require('node:child_process');
  const res = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'info', '-i', a, '-i', b, '-filter_complex', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = String(res.stderr || '').match(/average:([0-9.]+)/);
  return m ? Number(m[1]) : 0;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fve-hold-'));
  const src = path.join(dir, 'cam.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8', '-pix_fmt', 'yuv420p', src]);
  const m = { id: 'm1', path: src, name: 'cam.mp4', ...(await probe(src)) };
  // Clip 0..6s, hold the frame at source 3s for 2 timeline seconds (t=3..5 frozen).
  const project = {
    name: 'hold', ratio: '16:9', width: 640, height: 360, fps: 30, background: '#000000', media: [m],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 6, speed: 1, frameHold: { at: 3, duration: 2 } }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  };
  const out = path.join(dir, 'out.mp4');
  await runExport(project, out, () => {}).promise;
  assert.ok(fs.existsSync(out), 'export exists');
  const om = await probe(out);
  assert.ok(Math.abs(om.duration - 6) < 0.15, `duration ~6s, got ${om.duration}`);
  const frozenA = grab(out, 3.2, path.join(dir, 'a.png'));
  const frozenB = grab(out, 4.8, path.join(dir, 'b.png'));
  const holdPsnr = psnr(frozenA, frozenB);
  assert.ok(holdPsnr > 45, `frames inside the hold window are near-identical (PSNR ${holdPsnr})`);
  const movingA = grab(out, 1.0, path.join(dir, 'c.png'));
  const movingB = grab(out, 1.5, path.join(dir, 'd.png'));
  const movePsnr = psnr(movingA, movingB);
  assert.ok(movePsnr < 30, `frames outside the hold window still move (PSNR ${movePsnr})`);
  // Hold at the very start (no pre-roll) also exports.
  const project2 = { ...project, videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 6, speed: 1, frameHold: { at: 0.5, duration: 1 } }] };
  const out2 = path.join(dir, 'out2.mp4');
  await runExport(project2, out2, () => {}).promise;
  assert.ok(fs.existsSync(out2));
  const h2a = grab(out2, 0.7, path.join(dir, 'e.png'));
  const h2b = grab(out2, 1.4, path.join(dir, 'f.png'));
  assert.ok(psnr(h2a, h2b) > 45, 'start hold freezes');
  console.log('test-frame-hold-export: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
