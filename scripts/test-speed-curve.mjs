// Speed ramping / curve speed parity (Sprint 4, P0): clip.speedCurve is data,
// and ONE sampler (src/speedCurve.js) maps timeline time <-> source time for
// the preview, the store's lengths, and — through its CJS mirror
// electron/speedcurve.cjs — the export graph. Asserted five ways:
//  1. Mirror sync: ESM and CJS samplers agree (durations, both maps, segment
//     lists) across a corpus of constant, flat, ramped and preset clips.
//  2. Sampler math: a flat curve is the constant path bit-for-bit; the maps
//     are mutual inverses; a two-point ramp's duration is the analytic
//     integral; slices and splits conserve duration.
//  3. Store invariants: a constant-speed write retires the curve, a window
//     write keeps the window's slice, linked partners stay in sync.
//  4. REAL exports through buildExportArgs: the exported duration matches
//     the sampler within 2 frames + AAC priming (0.09 s), and the picture at
//     sampled timeline times is the source band the sampler predicts.
//  5. The same for the sound: the dominant tone at sampled timeline times is
//     the source second the sampler predicts (atempo segmentation follows
//     the same segments as the picture's setpts).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sc = require('../electron/speedcurve.cjs');
const { buildExportArgs, probe, ffmpegPath } = require('../electron/ffmpeg.cjs');
const esm = await import('../src/speedCurve.js');
const { applyClipPatch, historyReducer, normalizeProject, videoLayout } = await import('../src/store.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speedcurve-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| > ${tol}`);

// ---- 1. Mirror sync ---------------------------------------------------------------
const corpus = [
  { in: 0, out: 6, speed: 1 },
  { in: 2, out: 8, speed: 2.5 },
  { in: 0, out: 6, speed: 1, speedCurve: { points: [{ t: 0, speed: 1.5 }, { t: 6, speed: 1.5 }] } },
  { in: 1, out: 7, speed: 1, speedCurve: { points: [{ t: 0, speed: 0.5 }, { t: 6, speed: 2 }] } },
  { in: 0, out: 6, speed: 1, speedCurve: { points: [{ t: 0, speed: 1.6 }, { t: 2.4, speed: 0.3 }, { t: 3.6, speed: 0.3 }, { t: 6, speed: 1.6 }] } },
  { in: 0, out: 4, speed: 0.8, speedCurve: { points: [{ t: 0, speed: 0.8 }, { t: 1, speed: 3 }, { t: 2, speed: 0.4 }, { t: 4, speed: 2 }] } },
  { in: 3, out: 5, speed: 1, speedCurve: { points: [{ t: 0.5, speed: 0.2 }] } },
];
for (const clip of corpus) {
  approx(esm.clipDuration(clip), sc.clipDuration(clip), 1e-9, 'mirror duration');
  const dur = esm.clipDuration(clip);
  for (let lt = 0; lt <= dur; lt += 0.37) {
    approx(esm.sourceOffsetAt(clip, lt), sc.sourceOffsetAt(clip, lt), 1e-9, 'mirror sourceOffsetAt');
    approx(esm.speedAtTime(clip, lt), sc.speedAtTime(clip, lt), 1e-9, 'mirror speedAtTime');
  }
  for (let so = 0; so <= 6; so += 0.53) {
    approx(esm.timelineOffsetAt(clip, so), sc.timelineOffsetAt(clip, so), 1e-9, 'mirror timelineOffsetAt');
    approx(esm.speedAtSource(clip, so), sc.speedAtSource(clip, so), 1e-9, 'mirror speedAtSource');
  }
  const a = esm.curveSegments(clip);
  const b = sc.curveSegments(clip);
  assert.equal(a.length, b.length, 'mirror segment count');
  a.forEach((s, i) => {
    approx(s.srcOff, b[i].srcOff, 1e-9, 'mirror seg srcOff');
    approx(s.srcDur, b[i].srcDur, 1e-9, 'mirror seg srcDur');
    approx(s.tlDur, b[i].tlDur, 1e-9, 'mirror seg tlDur');
    approx(s.speed, b[i].speed, 1e-9, 'mirror seg speed');
  });
}
console.log(`  mirror: ${corpus.length} clips, maps and segments identical ESM <-> CJS`);

// ---- 2. Sampler math ----------------------------------------------------------------
{
  // Flat curve == constant path, bit-for-bit.
  const flat = { in: 1, out: 7, speed: 2, speedCurve: { points: [{ t: 0, speed: 2 }, { t: 6, speed: 2 }] } };
  const con = { in: 1, out: 7, speed: 2 };
  assert.equal(esm.clipDuration(flat), esm.clipDuration(con));
  for (const lt of [0, 0.5, 1.3, 3]) assert.equal(esm.sourceOffsetAt(flat, lt), esm.sourceOffsetAt(con, lt));
  assert.ok(esm.isFlatCurve(flat));
  // No curve == constant, trivially.
  assert.equal(esm.clipDuration({ in: 0, out: 6, speed: 0.5 }), 12);
  // Inverse maps round-trip on a wavy curve.
  const wavy = corpus[5];
  for (let lt = 0; lt <= esm.clipDuration(wavy); lt += 0.29) {
    approx(esm.timelineOffsetAt(wavy, esm.sourceOffsetAt(wavy, lt)), lt, 1e-6, 'round trip t->s->t');
  }
  for (let so = 0; so <= 4; so += 0.31) {
    approx(esm.sourceOffsetAt(wavy, esm.timelineOffsetAt(wavy, so)), so, 1e-6, 'round trip s->t->s');
  }
  // Two-point ramp duration is the analytic integral: span * ln(s1/s0) / (s1-s0).
  const ramp = corpus[3];
  approx(esm.clipDuration(ramp), 6 * Math.log(4) / 1.5, 1e-9, 'ramp analytic duration');
  // Slices conserve duration; a split's halves sum to the whole.
  const whole = esm.clipDuration(ramp);
  const head = { ...ramp, out: ramp.in + 2.5, speedCurve: esm.sliceCurve(ramp, 0, 2.5) };
  const tail = { ...ramp, in: ramp.in + 2.5, speedCurve: esm.sliceCurve(ramp, 2.5, 6) };
  approx(esm.clipDuration(head) + esm.clipDuration(tail), whole, 1e-9, 'split halves sum');
  approx(esm.clipDuration(head), esm.timelineOffsetAt(ramp, 2.5), 1e-9, 'head duration is the map');
  // Every preset's duration differs from constant in the direction its shape implies.
  for (const p of esm.SPEED_PRESETS) {
    const clip = { in: 0, out: 6, speed: 1, speedCurve: { points: esm.presetPoints(p, 6, 1) } };
    assert.ok(esm.hasCurve(clip) && esm.clipDuration(clip) > 0, `preset ${p.id} usable`);
  }
  console.log('  math: flat == constant, inverse maps, analytic ramp, slice/split conservation');
}

// ---- 3. Store invariants --------------------------------------------------------------
{
  const ramp = { id: 'a', mediaId: 'm', in: 0, out: 6, speed: 1, speedCurve: { points: [{ t: 0, speed: 0.5 }, { t: 6, speed: 2 }] } };
  // Constant-speed write retires the curve.
  const flat = applyClipPatch(ramp, { speed: 2 });
  assert.equal(flat.speedCurve, undefined, 'speed write retires curve');
  assert.equal(esm.clipDuration({ ...flat }), 3);
  // Window write keeps the window's slice.
  const win = applyClipPatch(ramp, { in: 2 });
  assert.ok(esm.hasCurve(win), 'window write keeps a curve');
  approx(esm.clipDuration(win), esm.clipDuration(ramp) - esm.timelineOffsetAt(ramp, 2), 1e-9, 'window slice duration');
  // Curve write is verbatim.
  const pts = [{ t: 0, speed: 3 }, { t: 6, speed: 3 }];
  assert.deepEqual(applyClipPatch(ramp, { speedCurve: { points: pts } }).speedCurve.points, pts);
  // A split through the reducer: both halves keep their slices and sum.
  const proj = { ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 30 }], videoClips: [{ ...ramp }] };
  let st = { past: [], present: proj, future: [] };
  st = historyReducer(st, { type: 'split', track: 'video', id: 'a', t: 2, newId: 'b' });
  const lay = videoLayout(st.present.videoClips);
  assert.equal(lay.length, 2, 'split produced two clips');
  // Stored curve points are millisecond-quantized, so store-level splits
  // conserve duration to ~1 ms, not to float precision.
  approx(lay[0].end - lay[0].start, 2, 2e-3, 'split head length');
  approx((lay[0].end - lay[0].start) + (lay[1].end - lay[1].start), esm.clipDuration(ramp), 2e-3, 'split total conserved');
  console.log('  store: speed write retires, window write slices, split conserves');
}

// ---- 4+5. Real exports: picture and sound follow the sampler -------------------------
// Fixture: 6 source seconds, a distinct colour and tone per second.
const COLORS = [[255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255]];
const FREQS = [300, 500, 700, 900, 1100, 1300];
const srcFile = path.join(dir, 'bands.mp4');
{
  const inputs = [];
  COLORS.forEach((_, i) => { inputs.push('-f', 'lavfi', '-i', `color=c=0x${COLORS[i].map((v) => v.toString(16).padStart(2, '0')).join('')}:size=320x240:rate=30:duration=1`); });
  FREQS.forEach((f) => { inputs.push('-f', 'lavfi', '-i', `sine=frequency=${f}:duration=1`); });
  const vChain = `${COLORS.map((_, i) => `[${i}:v]`).join('')}concat=n=6:v=1:a=0[v]`;
  const aChain = `${FREQS.map((_, i) => `[${6 + i}:a]`).join('')}concat=n=6:v=0:a=1[a]`;
  gen([...inputs, '-filter_complex', `${vChain};${aChain}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', srcFile]);
}
const mediaEntry = { id: 'm1', path: srcFile, name: 'bands.mp4', type: 'video', ...(await probe(srcFile)) };
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const mkProject = (clip) => ({
  name: 'speed-parity', ratio: '4:3', width: 320, height: 240, fps: 30, background: '#000000',
  media: [mediaEntry], videoClips: [{ ...base, id: 'c1', mediaId: 'm1', ...clip }], overlayClips: [], textClips: [], audioClips: [],
});

const frameBand = (file, lt) => {
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(lt), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const mid = (120 * 320 + 160) * 3;
  const px = [raw[mid], raw[mid + 1], raw[mid + 2]];
  let best = -1; let bd = Infinity;
  COLORS.forEach((c, i) => { const d = (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
};
const toneBand = (pcm, lt) => {
  const sr = 48000; const n = Math.floor(0.3 * sr); const off = Math.floor(lt * sr);
  let best = -1; let bp = -1;
  FREQS.forEach((f, i) => {
    let re = 0; let im = 0;
    for (let k = 0; k < n; k++) {
      const s = pcm[off + k] || 0;
      const a = (2 * Math.PI * f * k) / sr;
      re += s * Math.cos(a); im -= s * Math.sin(a);
    }
    const p = re * re + im * im;
    if (p > bp) { bp = p; best = i; }
  });
  return best;
};

async function exportCase(label, clip) {
  const out = path.join(dir, `${label}.mp4`);
  const { args, total } = buildExportArgs(mkProject(clip), out);
  approx(total, esm.clipDuration(clip), 1e-9, `${label}: graph total is the sampler duration`);
  execFileSync(ffmpegPath, args, { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const info = await probe(out);
  approx(info.duration, esm.clipDuration(clip), 0.09, `${label}: exported duration`);
  const pcmBuf = execFileSync(ffmpegPath, ['-v', 'error', '-i', out, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Float32Array(pcmBuf.buffer.slice(pcmBuf.byteOffset, pcmBuf.byteOffset + pcmBuf.length));
  let checked = 0;
  for (let lt = 0.45; lt < esm.clipDuration(clip) - 0.4; lt += 0.45) {
    const src = esm.sourceOffsetAt(clip, lt);
    if (Math.abs(src - Math.round(src)) < 0.18) continue; // too close to a band edge to judge
    const want = Math.floor(src);
    assert.equal(frameBand(out, lt), want, `${label}: picture at t=${lt.toFixed(2)} (source ${src.toFixed(2)})`);
    assert.equal(toneBand(pcm, lt), want, `${label}: sound at t=${lt.toFixed(2)} (source ${src.toFixed(2)})`);
    checked++;
  }
  assert.ok(checked >= 6, `${label}: enough samples checked (${checked})`);
  console.log(`  export ${label}: duration ${info.duration.toFixed(3)}s vs sampler ${esm.clipDuration(clip).toFixed(3)}s; ${checked} picture+sound samples on the predicted band`);
}

await exportCase('ramp', { in: 0, out: 6, speedCurve: { points: [{ t: 0, speed: 0.5 }, { t: 6, speed: 2 }] } });
await exportCase('bullet', { in: 0, out: 6, speedCurve: { points: esm.presetPoints(esm.SPEED_PRESETS.find((p) => p.id === 'bullet'), 6, 1) } });

console.log('speed-curve OK: one sampler drives store, preview map and export render — picture and sound');
