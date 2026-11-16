// FB-09 (P1-18): equal-power crossfades + fade drag handles.
//
// 1. Graph: every acrossfade the engine emits — video export, audio export,
//    timeline-audio builder — carries the explicit equal-power curve.
// 2. Render: two uncorrelated noise tracks joined by a 1 s transition —
//    midpoint dip < 1.5 dB, peak <= 0 dBFS, no pop — at 48 kHz through the
//    real audio export and at 44.1 kHz through the raw filter. A triangular
//    control run is measured too, proving the test can tell the difference
//    (it dips ~-2.9 dB).
// 3. Fade handles: the data contract the handles write (clip.fadeIn /
//    fadeOut driving clipGainAt) plus the wiring (onDragFade at all three
//    VolLine call sites, .vol-fade-handle CSS). The live drag itself is
//    covered by the F2 live suite (scripts/test-f2-live.mjs).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, buildAudioExportArgs, buildTimelineAudioArgs, probe, ffmpegPath } = require('/home/hatch/.tmp-cc-f2/electron/ffmpeg.cjs');
const { clipGainAt } = await import('/home/hatch/.tmp-cc-f2/src/volKeys.js');
const root = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb09-'));
const gen = (a) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...a]);
const decode = (file, from, len, sr) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ss', String(from), '-t', String(len), '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = raw.length / 4; const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = raw.readFloatLE(i * 4); return o;
};
const rms = (s) => { let a = 0; for (let i = 0; i < s.length; i++) a += s[i] * s[i]; return Math.sqrt(a / s.length); };
const peak = (s) => { let m = 0; for (let i = 0; i < s.length; i++) m = Math.max(m, Math.abs(s[i])); return m; };
const maxStep = (s) => { let m = 0; for (let i = 1; i < s.length; i++) m = Math.max(m, Math.abs(s[i] - s[i - 1])); return m; };
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));

// Two uncorrelated noise tracks with picture, so all three builders join them.
const mkMp4 = (name, seed) => {
  const out = path.join(dir, name);
  gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=3',
    '-f', 'lavfi', '-i', `anoisesrc=color=white:duration=3:amplitude=0.5:seed=${seed}`,
    '-shortest', '-ar', '48000', '-ac', '2', out]);
  return out;
};
const aPath = mkMp4('a.mp4', 1);
const bPath = mkMp4('b.mp4', 2);
const media = [
  { id: 'm1', path: aPath, name: 'a.mp4', ...(await probe(aPath)) },
  { id: 'm2', path: bPath, name: 'b.mp4', ...(await probe(bPath)) },
];
const clip = (id, mediaId, transition) => ({
  id, mediaId, in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0, speed: 1,
  muted: false, filter: 'none', adjust: {}, effects: [], transition: transition || null,
});
const project = {
  name: 'xfade', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#000000', media,
  videoClips: [clip('c1', 'm1'), clip('c2', 'm2', { type: 'fade', duration: 1 })],
  overlayClips: [], textClips: [], audioClips: [],
};

// 1. Graph: no bare acrossfade anywhere; every join carries the curve.
{
  const graphs = {
    video: buildExportArgs(project, path.join(dir, 'out.mp4')).args.join(' '),
    audio: buildAudioExportArgs(project, path.join(dir, 'out.wav'), 'wav').join(' '),
    timeline: buildTimelineAudioArgs(project, path.join(dir, 'tl.wav')).join(' '),
  };
  for (const [name, g] of Object.entries(graphs)) {
    const joins = [...g.matchAll(/acrossfade=d=[0-9.]+(?::[^\s\[]+)?/g)].map((m) => m[0]);
    assert.ok(joins.length >= 1, `${name} export joins with acrossfade`);
    for (const j of joins) assert.ok(j.includes('c1=qsin:c2=qsin'), `${name} join is equal-power: ${j}`);
    assert.ok(!/acrossfade=d=[0-9.]+(\[| |$)/.test(g), `${name} export has no bare acrossfade without a curve`);
  }
  console.log('  graph: video/audio/timeline joins all carry c1=qsin:c2=qsin');
}

// 2a. Real render at 48 kHz through the audio export.
{
  const out = path.join(dir, 'x48.wav');
  execFileSync(ffmpegPath, buildAudioExportArgs(project, out, 'wav'), { stdio: 'pipe' });
  // Output is 5 s: A[0..2] + crossfade[2..3] + B[3..5]; midpoint 2.5 s.
  const pre = decode(out, 0.5, 1, 48000);
  const mid = decode(out, 2.45, 0.1, 48000);
  const post = decode(out, 3.5, 1, 48000);
  const all = decode(out, 0, 5, 48000);
  const dip = db(rms(mid) / rms(pre));
  console.log(`  export 48 kHz: dip ${dip.toFixed(2)} dB, peak ${peak(all).toFixed(3)}, max step xfade ${maxStep(decode(out, 2, 1, 48000)).toFixed(3)} vs pure ${Math.max(maxStep(pre), maxStep(post)).toFixed(3)}`);
  assert.ok(Math.abs(dip) < 1.5, `48 kHz midpoint dip ${dip.toFixed(2)} dB (target < 1.5 dB)`);
  assert.ok(peak(all) <= 1.0, `48 kHz peak ${peak(all).toFixed(3)} <= 0 dBFS`);
  assert.ok(maxStep(decode(out, 2, 1, 48000)) < 3 * Math.max(maxStep(pre), maxStep(post)), 'no pop in the crossfade window');
}

// 2b. Raw filter at 44.1 kHz, plus the triangular control.
for (const [curve, want] of [['c1=qsin:c2=qsin', 'flat'], ['c1=tri:c2=tri', 'dip']]) {
  const out = path.join(dir, `x44-${want}.wav`);
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=2:amplitude=0.5:seed=1',
    '-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=2:amplitude=0.5:seed=2',
    '-filter_complex', `[0:a][1:a]acrossfade=d=1:${curve}[o]`, '-map', '[o]', '-ar', '44100', '-ac', '2', out]);
  const dip = db(rms(decode(out, 1.45, 0.1, 44100)) / rms(decode(out, 0.3, 0.6, 44100)));
  console.log(`  raw 44.1 kHz ${curve}: dip ${dip.toFixed(2)} dB`);
  if (want === 'flat') assert.ok(Math.abs(dip) < 1.5, `44.1 kHz qsin dip ${dip.toFixed(2)} dB`);
  else assert.ok(dip < -1.5, `triangular control still dips ${dip.toFixed(2)} dB (test discriminates)`);
}

// 3. Fade handles: the fields they write drive the preview gain the export
// renders, and the wiring exists at all three VolLine call sites.
{
  const c = { volume: 1, fadeIn: 0, fadeOut: 0 };
  assert.equal(clipGainAt({ ...c, fadeIn: 0 }, 0.5, 3), 1, 'no fade: full gain mid-clip');
  assert.ok(Math.abs(clipGainAt({ ...c, fadeIn: 1 }, 0.5, 3) - 0.5) < 1e-9, 'fadeIn 1 s: gain 0.5 halfway up the ramp');
  assert.ok(Math.abs(clipGainAt({ ...c, fadeOut: 1 }, 2.5, 3) - 0.5) < 1e-9, 'fadeOut 1 s: gain 0.5 halfway down the ramp');
  const tl = fs.readFileSync(path.join(root, '..', 'src', 'components', 'Timeline.jsx'), 'utf8');
  // AU-03 added FadeHandles alongside VolLine, so each of the three sites
  // (overlay / video / audio) now wires onDragFade twice — once on the
  // volume line's fade squares, once on the corner triangles. Count sites,
  // not occurrences: both components must be wired at all three sites.
  for (const site of ['overlay', 'video', 'audio']) {
    assert.ok(tl.includes(`startFadeDrag(e, '${site}'`), `fade handles wired at the ${site} site`);
  }
  assert.equal((tl.match(/<VolLine /g) || []).length, 3, 'VolLine at overlay/video/audio sites');
  assert.equal((tl.match(/<FadeHandles /g) || []).length, 3, 'FadeHandles at overlay/video/audio sites');
  assert.ok(tl.includes('startFadeDrag'), 'startFadeDrag exists');
  const css = fs.readFileSync(path.join(root, '..', 'src', 'styles.css'), 'utf8');
  assert.ok(css.includes('.vol-fade-handle'), 'fade handle CSS exists');
}
console.log('FB-09 OK: equal-power crossfades (qsin, dip < 1.5 dB at 44.1/48 kHz), fade handles wired');
