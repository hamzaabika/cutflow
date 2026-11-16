// P0-09 blend-path pin: stacking blend-mode overlays must not degrade the base
// picture through repeated YUV->RGB->YUV round-trips. A WHITE top under
// 'multiply' is the identity blend (1.0 * B = B), so N white multiply overlays
// = N round-trips with (near-)identical intended output. Measured 2026-11-15
// on a gradient base: 1 trip and 13 trips both read 45.64 dB vs the no-overlay
// export — one quantization step, not cumulative (the conversion converges to
// a fixed point after the first trip). The encoder is deterministic (the same
// project re-encoded is bit-identical), so the PSNR differences are real
// pipeline loss, not encoder noise. A red multiply control proves the blend
// path is live and formula-accurate.
// Usage: node scripts/test-blend-psnr.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-blendpsnr-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const psnr = (ref, test) => {
  const r = spawnSync(ffmpegPath, ['-i', ref, '-i', test, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:(inf|[\d.]+)/.exec(r.stderr || '');
  return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : null;
};
const pixel = (file, t, x, y) => [...execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
  '-vf', `crop=4:4:${x}:${y},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

(async () => {
  // Gradient base (not a flat solid): a round-trip that quantizes would band
  // a gradient, and repeated trips would make it worse if cumulative.
  const baseF = path.join(dir, 'base.mp4');
  gen(['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:r=30:d=2:c0=0x204060:c1=0xc0a040`, '-pix_fmt', 'yuv420p', baseF]);
  const whiteF = path.join(dir, 'white.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=0xffffff:s=${W}x${H}:r=30:d=2`, '-pix_fmt', 'yuv420p', whiteF]);
  const media = [];
  for (const [id, p] of [['b', baseF], ['w', whiteF]]) media.push({ id, path: p, name: id, ...(await probe(p)) });
  const clipBase = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mk = (n) => ({
    name: 'blendpsnr', width: W, height: H, fps: 30, background: '#000000', media,
    videoClips: [{ ...clipBase, id: 'base', mediaId: 'b', in: 0, out: 2 }],
    overlayClips: Array.from({ length: n }, (_, i) => ({ ...clipBase, id: `w${i}`, mediaId: 'w', start: 0, in: 0, out: 2, blend: 'multiply' })),
    textClips: [], audioClips: [], stickerClips: [],
  });
  const ref = path.join(dir, 'ref0.mp4');
  await runExport(mk(0), ref, () => {}).promise;
  // Encoder floor: the same project re-encoded must be bit-identical, so any
  // PSNR below inf below is pipeline loss, not encoder noise.
  const ref2 = path.join(dir, 'ref0b.mp4');
  await runExport(mk(0), ref2, () => {}).promise;
  ok(psnr(ref, ref2) === Infinity, 'encoder floor: same project re-encoded is bit-identical');
  const p1 = psnr(ref, await runExport(mk(1), path.join(dir, 'blend-1.mp4'), () => {}).promise.then(() => path.join(dir, 'blend-1.mp4')));
  const p13 = psnr(ref, await runExport(mk(13), path.join(dir, 'blend-13.mp4'), () => {}).promise.then(() => path.join(dir, 'blend-13.mp4')));
  console.log(`  white-multiply x1 PSNR ${p1?.toFixed(2)} dB, x13 PSNR ${p13?.toFixed(2)} dB`);
  ok(p1 !== null && p1 >= 40, `one blend round-trip keeps the frame (PSNR ${p1?.toFixed(2)} dB >= 40)`);
  ok(p13 !== null && Math.abs(p13 - p1) < 0.5, `thirteen round-trips cost no more than one (x13 ${p13?.toFixed(2)} dB vs x1 ${p1?.toFixed(2)} dB)`);
  // Control: the blend path is live — a red multiply top darkens the base per
  // the formula (base centre sampled from the no-overlay export itself).
  const redF = path.join(dir, 'red.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=0xcc6633:s=${W}x${H}:r=30:d=2`, '-pix_fmt', 'yuv420p', redF]);
  const media2 = [{ id: 'b', path: baseF, name: 'b', ...(await probe(baseF)) }, { id: 'r', path: redF, name: 'r', ...(await probe(redF)) }];
  const redProj = {
    name: 'blendred', width: W, height: H, fps: 30, background: '#000000', media: media2,
    videoClips: [{ ...clipBase, id: 'base', mediaId: 'b', in: 0, out: 2 }],
    overlayClips: [{ ...clipBase, id: 'top', mediaId: 'r', start: 0, in: 0, out: 2, blend: 'multiply' }],
    textClips: [], audioClips: [], stickerClips: [],
  };
  const redOut = path.join(dir, 'blend-red.mp4');
  await runExport(redProj, redOut, () => {}).promise;
  const basePx = pixel(ref, 1, 160, 90);
  const redPx = pixel(redOut, 1, 160, 90);
  const exp = basePx.map((v, i) => Math.round((v * [204, 102, 51][i]) / 255));
  console.log(`  red-multiply centre: got rgb(${redPx}), expected ~rgb(${exp}) from base rgb(${basePx})`);
  ok(redPx.every((v, i) => Math.abs(v - exp[i]) <= 12), 'red multiply matches the blend formula');
  console.log(failures ? `BLEND PSNR FAIL — ${failures} assertion(s)` : 'BLEND PSNR OK — 1 trip and 13 trips cost the same (one quantization step)');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
