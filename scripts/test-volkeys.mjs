// Volume keyframes + picture-clip audio fades (Sprint 10).
//   - src/volKeys.js and electron/volkeys.cjs are two mirrors of ONE gain
//     model (src/volKeys.js header); the corpus below proves they agree on
//     normalization, curve points and sampled traces.
//   - The stack order is defined once: mute → keyframe curve (or volume) →
//     fade envelope. Splits keep the curve glued to the source; extracting
//     a picture clip's audio carries its fades and keyframes onto the new
//     audio clip.
//   - PARITY, measured on rendered audio: an export of a keyframed clip
//     (audio-track and picture paths) is decoded and its windowed RMS is
//     compared against the RMS the PREVIEW's gain function (clipGainAt)
//     predicts for the same windows. The export args used are the audio
//     export's own mixdown graph (buildAudioExportArgs — the phase the
//     master loudnorm stage later measures, so the comparison is against
//     the graph itself, not the mastered file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ffmpegPath, ffprobePath, probe, buildAudioExportArgs } = require('../electron/ffmpeg.cjs');
const vkC = require('../electron/volkeys.cjs');
const vkE = await import('../src/volKeys.js');
const store = await import('../src/store.js');
const { clipDuration } = await import('../src/speedCurve.js');
const { resolveExport } = await import('../src/exportQuality.js');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// --- Mirror sync ---------------------------------------------------------------
{
  const corpus = [
    { in: 0, out: 6, speed: 1, volume: 1 },
    { in: 0, out: 6, speed: 1, volume: 0.4, fadeIn: 1, fadeOut: 2 },
    { in: 0, out: 6, speed: 1, volume: 1, volKeys: [{ t: 0, v: 1 }, { t: 2, v: 0.1 }, { t: 4, v: 1 }] },
    { in: 2, out: 9, speed: 2, volume: 1, volKeys: [{ t: 3, v: 0.2 }, { t: 5, v: 1.4 }, { t: 5, v: 0.7 }, { t: 20, v: 1 }] },
    { in: 0, out: 8, speed: 1, volume: 1, fadeIn: 1.5, volKeys: [{ t: 0, v: 0 }, { t: 8, v: 2 }] },
    { in: 1, out: 7, speed: 1, volume: 1, speedCurve: { points: [{ t: 0, speed: 1 }, { t: 3, speed: 0.5 }, { t: 6, speed: 1 }] }, volKeys: [{ t: 2, v: 1 }, { t: 4, v: 0.3 }] },
  ];
  let tracesAgree = true;
  let pointsAgree = true;
  for (const clip of corpus) {
    const len = clipDuration(clip);
    const a = vkE.volCurvePoints(clip, len);
    const b = vkC.volCurvePoints(clip, len);
    if (a.length !== b.length || a.some((p, i) => !near(p[0], b[i][0], 1e-6) || !near(p[1], b[i][1], 1e-6))) pointsAgree = false;
    for (let lt = 0; lt <= len; lt += 0.173) {
      if (!near(vkE.clipGainAt(clip, lt, len), vkC.clipGainAt(clip, lt, len), 1e-9)) tracesAgree = false;
    }
    const ea = vkE.normalizeVolKeys(clip);
    const eb = vkC.normalizeVolKeys(clip);
    if (ea.length !== eb.length || ea.some((k, i) => !near(k.t, eb[i].t) || !near(k.v, eb[i].v))) tracesAgree = false;
  }
  ok(pointsAgree, 'mirror: export curve points identical between src and electron samplers');
  ok(tracesAgree, 'mirror: gain traces and normalization identical across the corpus (incl. speed and speed-curve clips)');
}

// --- Store behaviour -------------------------------------------------------------
{
  const p0 = store.emptyProject();
  const clip = { id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null,
    fadeIn: 0.5, fadeOut: 0.5, volKeys: [{ t: 0, v: 1 }, { t: 3, v: 0.2 }, { t: 6, v: 1 }] };
  const p = { ...p0, media: [{ id: 'm1', path: '/x/v.mp4', type: 'video', duration: 6, width: 320, height: 180, hasAudio: true }], videoClips: [clip] };
  const st = store.historyReducer({ past: [], present: p, future: [] },
    { type: 'split', track: 'video', id: 'v1', t: 2, newId: 'v2' });
  const [l, r] = st.present.videoClips;
  let glued = true;
  for (let lt = 0; lt < 2; lt += 0.31) if (!near(vkE.volumeAt(l, lt), vkE.volumeAt(clip, lt), 1e-9)) glued = false;
  for (let lt = 0; lt < 4; lt += 0.31) if (!near(vkE.volumeAt(r, lt), vkE.volumeAt(clip, 2 + lt), 1e-9)) glued = false;
  ok(glued && l.volKeys && r.volKeys, 'split keeps the keyframe curve glued to the source on both halves');

  const ex = store.historyReducer({ past: [], present: p, future: [] },
    { type: 'extractAudio', track: 'video', id: 'v1', newId: 'a1' });
  const a = ex.present.audioClips.find((c) => c.id === 'a1');
  ok(a && near(a.fadeIn, 0.5) && near(a.fadeOut, 0.5) && JSON.stringify(a.volKeys) === JSON.stringify(clip.volKeys),
    'extract audio carries the picture clip\'s fades and keyframes onto the audio clip');
  ok(near(store.exportDuration(ex.present), 6), 'extract leaves the timeline duration unchanged (the pair stays in sync)');
}

// --- Rendered parity ---------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-volk-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
// Decoded at each file's NATIVE channel count, RMS taken over every
// sample: resampler up/downmixes scale identical channels by √2, which
// would poison the comparison — native counts keep source and export on
// the same basis (the fixtures' channels are identical or mono).
const channelsOf = (file) => Number(execFileSync(ffprobePath,
  ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file]).toString().trim()) || 1;
const decodeCache = new Map();
function decode(file) {
  if (!decodeCache.has(file)) {
    const ch = channelsOf(file);
    const buf = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(ch), '-ar', '48000', '-'], { maxBuffer: 256 * 1024 * 1024 });
    decodeCache.set(file, { buf, ch });
  }
  return decodeCache.get(file);
}
function windowRms(file, t0, t1) {
  const { buf, ch } = decode(file);
  const a = Math.floor(t0 * 48000) * 4 * ch;
  const b = Math.min(buf.length, Math.floor(t1 * 48000) * 4 * ch);
  let sum = 0;
  let n = 0;
  for (let i = a; i < b; i += 4) { const v = buf.readFloatLE(i); sum += v * v; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}
// The parity claim, per window: measured RMS = source RMS × the RMS gain
// clipGainAt predicts. Two numbers are reported per case:
//   - the envelope SPREAD (max/min of the measured÷predicted ratio): the
//     curve's SHAPE. A chain may carry a constant channel-layout factor
//     (a power-preserving mono→stereo upmix scales each channel by 1/√2),
//     which moves every window together and is not a gain error — but a
//     wrong curve (double-applied, shifted, flattened) moves windows
//     relative to each other and blows the spread.
//   - the MEDIAN ratio: the absolute level, asserted where the chain's
//     channel handling is level-preserving (the picture path's pan).
function checkParity(outFile, clip, len, srcRms, label, assertAbsolute) {
  const ratios = [];
  for (let t0 = 0; t0 + 0.25 <= len + 1e-9; t0 += 0.25) {
    let g2 = 0;
    const N = 50;
    for (let i = 0; i < N; i++) { const g = vkE.clipGainAt(clip, t0 + ((i + 0.5) / N) * 0.25, len); g2 += g * g; }
    const pred = srcRms * Math.sqrt(g2 / N);
    if (pred < 0.15 * srcRms) continue; // near-silent windows carry no signal to compare
    ratios.push(windowRms(outFile, t0, t0 + 0.25) / pred);
  }
  const spread = Math.max(...ratios) / Math.min(...ratios);
  const median = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
  ok(spread <= 1.12, `${label}: exported envelope follows the preview gain trace (ratio spread ${spread.toFixed(3)}, tolerance 1.12)`);
  if (assertAbsolute) {
    ok(Math.abs(median - 1) <= 0.12, `${label}: absolute level matches too (median ratio ${median.toFixed(3)}, tolerance ±12%)`);
  } else {
    console.log(`       (${label}: median ratio ${median.toFixed(3)} — the chain's constant channel-layout factor, uniform across windows)`);
  }
  return { spread, median };
}

// Constant tone source (amplitude 0.5 → RMS ≈ 0.3536), measured not assumed.
const srcWav = path.join(dir, 'tone.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=0.5', '-ar', '48000', '-ac', '1', srcWav]);
const srcRms = windowRms(srcWav, 0.5, 5.5);

const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const exportSettings = { preset: 'custom', custom: { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 192 } };
function renderAudioOnly(project, name) {
  const out = path.join(dir, name);
  const args = buildAudioExportArgs(project, out, 'wav');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  return { out, args: args.join(' ') };
}

// (a) Audio-track clip with a keyframed dip.
{
  const clip = { id: 'a1', mediaId: 'mA', start: 0, in: 0, out: 6, volume: 1, fadeIn: 0, fadeOut: 0,
    volKeys: [{ t: 0, v: 1 }, { t: 2, v: 0.1 }, { t: 4, v: 1 }] };
  const p = { name: 'vk', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010',
    media: [{ id: 'mA', path: srcWav, type: 'audio', duration: 6 }],
    videoClips: [], overlayClips: [], textClips: [], audioClips: [clip], exportSettings };
  p.export = resolveExport(p, { libx265: true, vp9: true });
  const { out, args } = renderAudioOnly(p, 'a.wav');
  ok(args.includes('eval=frame'), 'keyframed clip exports through an evaluated volume expression');
  checkParity(out, clip, 6, srcRms, 'audio-track keyframes', false);
}

// (b) Flat clip: the historical constant form, no expression evaluation.
{
  const clip = { id: 'a1', mediaId: 'mA', start: 0, in: 0, out: 6, volume: 0.8, fadeIn: 0, fadeOut: 0 };
  const p = { name: 'vk', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010',
    media: [{ id: 'mA', path: srcWav, type: 'audio', duration: 6 }],
    videoClips: [], overlayClips: [], textClips: [], audioClips: [clip], exportSettings };
  p.export = resolveExport(p, { libx265: true, vp9: true });
  const { args } = renderAudioOnly(p, 'b.wav');
  ok(args.includes('volume=0.8') && !args.includes('eval=frame'), 'flat clip keeps the historical constant volume form');
}

// (c) Picture clip: keyframes AND fades shape its own audio in the export.
{
  const srcMp4 = path.join(dir, 'pic.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', srcMp4]);
  const info = await probe(srcMp4);
  const clip = { ...base, id: 'v1', mediaId: 'mV', in: 0, out: 6, fadeIn: 1, fadeOut: 1,
    volKeys: [{ t: 0, v: 1 }, { t: 3, v: 0.25 }, { t: 6, v: 1 }] };
  const p = { name: 'vk', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010',
    media: [{ id: 'mV', path: srcMp4, name: 'pic.mp4', ...info }],
    videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], exportSettings };
  p.export = resolveExport(p, { libx265: true, vp9: true });
  const { out, args } = renderAudioOnly(p, 'c.wav');
  ok(args.includes('afade=t=in') && args.includes('afade=t=out'), 'picture-clip fades reach the export graph (afade in/out)');
  const picRms = windowRms(srcMp4, 0.5, 5.5);
  checkParity(out, clip, 6, picRms, 'picture-clip keyframes + fades', true);
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nVOLKEYS OK');
process.exit(fails.length ? 1 : 0);
