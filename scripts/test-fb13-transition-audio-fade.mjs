// FB-13 (P1-10): independently editable audio fades per transition.
//
// clip.transition.audioFade = { mode: 'auto' | 'custom' | 'off', duration }.
//   auto (or absent): acrossfade over the video transition duration.
//   custom: acrossfade over its own duration, clamped to half of each clip.
//   off: hard cut at the transition midpoint (A trimmed to it, B from it,
//        then concat) — the total length must stay L1 + L2 - td, no drift.
// Renders use two tones (440 vs 880 Hz) so the cut position and the
// crossfade span are readable with Goertzel, plus an RMS dip check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, buildAudioExportArgs, buildTimelineAudioArgs, probe, ffmpegPath, ffprobePath } = require('/home/hatch/.tmp-cc-f2/electron/ffmpeg.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb13-'));
const gen = (a) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...a]);
const decode = (file, from, len, sr = 48000) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ss', String(from), '-t', String(len), '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = raw.length / 4; const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = raw.readFloatLE(i * 4); return o;
};
const goertzel = (s, freq, sr = 48000) => {
  const n = s.length, k = Math.round((n * freq) / sr), w = (2 * Math.PI * k) / n, cw = Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const x = s[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))); const v = x + 2 * cw * s1 - s2; s2 = s1; s1 = v; }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / n;
};
const rms = (s) => { let a = 0; for (let i = 0; i < s.length; i++) a += s[i] * s[i]; return Math.sqrt(a / s.length); };
const peak = (s) => { let m = 0; for (let i = 0; i < s.length; i++) m = Math.max(m, Math.abs(s[i])); return m; };
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));
const durationOf = (file) => {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseFloat(out.trim());
};

const mkMp4 = (name, freq) => {
  const out = path.join(dir, name);
  gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=3',
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=3`,
    '-filter_complex', '[1:a]volume=0.4[a]', '-map', '0:v', '-map', '[a]', '-shortest', '-ar', '48000', '-ac', '2', out]);
  return out;
};
const aPath = mkMp4('a.mp4', 440);
const bPath = mkMp4('b.mp4', 880);
const media = [
  { id: 'm1', path: aPath, name: 'a.mp4', ...(await probe(aPath)) },
  { id: 'm2', path: bPath, name: 'b.mp4', ...(await probe(bPath)) },
];
const mkProject = (audioFade) => ({
  name: 'trfade', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#000000', media,
  videoClips: [
    { id: 'c1', mediaId: 'm1', in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0, speed: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    { id: 'c2', mediaId: 'm2', in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0, speed: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: { type: 'fade', duration: 1, ...(audioFade ? { audioFade } : {}) } },
  ],
  overlayClips: [], textClips: [], audioClips: [],
});
const renderAudio = (project, name) => {
  const out = path.join(dir, name);
  execFileSync(ffmpegPath, buildAudioExportArgs(project, out, 'wav'), { stdio: 'pipe' });
  return out;
};

// 1. Graph: all three builders honour the mode.
{
  const cases = [
    [undefined, /acrossfade=d=1\.000:c1=qsin:c2=qsin/, 'absent = auto, acrossfade over the video 1 s'],
    [{ mode: 'auto' }, /acrossfade=d=1\.000:c1=qsin:c2=qsin/, 'auto acrossfades over the video duration'],
    [{ mode: 'custom', duration: 0.3 }, /atrim=start=0:end=2\.650.*atrim=start=0\.350.*acrossfade=d=0\.300:c1=qsin:c2=qsin/s, 'custom 0.3 s, centred on the 2.5 s midpoint'],
    [{ mode: 'custom', duration: 5 }, /acrossfade=d=1\.000:c1=qsin:c2=qsin/, 'custom 5 s clamps to the 1 s video overlap (a longer audio fade cannot fit the join)'],
    [{ mode: 'off' }, /atrim=start=0:end=2\.500.*atrim=start=0\.500.*concat=n=2:v=0:a=1/s, 'off trims to the 2.5 s midpoint and concats'],
  ];
  for (const [af, re, label] of cases) {
    const p = mkProject(af);
    for (const [name, g] of [
      ['video', buildExportArgs(p, path.join(dir, 'v.mp4')).args.join(' ')],
      ['audio', buildAudioExportArgs(p, path.join(dir, 'a.wav'), 'wav').join(' ')],
      ['timeline', buildTimelineAudioArgs(p, path.join(dir, 't.wav')).join(' ')],
    ]) {
      assert.ok(re.test(g), `${name} export, ${label}`);
      if (af?.mode === 'off') assert.ok(!g.includes('acrossfade'), `${name} export, off uses no acrossfade for this join`);
    }
  }
  console.log('  graph: auto/custom/clamped-custom/off agree across video/audio/timeline builders');
}

// 2. Renders through the real audio export (5 s total in every mode: no drift).
const tone = (file, from, len, freq) => goertzel(decode(file, from, len), freq);
for (const [af, label] of [[undefined, 'auto'], [{ mode: 'custom', duration: 0.3 }, 'custom 0.3'], [{ mode: 'off' }, 'off']]) {
  const out = renderAudio(mkProject(af), `x-${label.replace(/[^a-z0-9]/gi, '')}.wav`);
  const dur = durationOf(out);
  const all = decode(out, 0, 5);
  console.log(`  ${label}: duration ${dur.toFixed(2)} s, peak ${peak(all).toFixed(3)}`);
  assert.ok(Math.abs(dur - 5) < 0.05, `${label}: total stays 5 s (got ${dur.toFixed(2)}), no A/V drift`);
  assert.ok(peak(all) <= 1.0, `${label}: peak ${peak(all).toFixed(3)} <= 0 dBFS`);
  if (label === 'off') {
    // Cut at 2.5 s: 440 dominates before, 880 after, levels unchanged.
    const before440 = tone(out, 2.0, 0.4, 440), before880 = tone(out, 2.0, 0.4, 880);
    const after440 = tone(out, 2.6, 0.4, 440), after880 = tone(out, 2.6, 0.4, 880);
    console.log(`  off: before 440 ${before440.toFixed(3)} / 880 ${before880.toFixed(3)}; after 440 ${after440.toFixed(3)} / 880 ${after880.toFixed(3)}`);
    assert.ok(before440 > 10 * before880, 'off: pure 440 before the cut');
    assert.ok(after880 > 10 * after440, 'off: pure 880 after the cut');
    assert.ok(Math.abs(db(after880 / before440)) < 1, 'off: no gain change across the cut');
  }
  if (label === 'auto') {
    const dip = db(rms(decode(out, 2.45, 0.1)) / rms(decode(out, 0.5, 1)));
    console.log(`  auto: midpoint dip ${dip.toFixed(2)} dB`);
    assert.ok(Math.abs(dip) < 1.5, `auto midpoint dip ${dip.toFixed(2)} dB`);
  }
  if (label === 'custom 0.3') {
    // Crossfade spans [2.35, 2.65], centred on the 2.5 s midpoint: pure
    // 440 at 2.0–2.3 s, both at 2.45–2.55 s, pure 880 at 3.5 s.
    assert.ok(tone(out, 2.0, 0.3, 440) > 10 * tone(out, 2.0, 0.3, 880), 'custom: pure 440 before the 0.3 s fade');
    const m440 = tone(out, 2.45, 0.1, 440), m880 = tone(out, 2.45, 0.1, 880);
    assert.ok(m440 > 0.3 * tone(out, 0.5, 0.5, 440) && m880 > 0.3 * tone(out, 3.5, 0.5, 880), 'custom: both tones present mid-fade');
    assert.ok(tone(out, 3.5, 0.5, 880) > 10 * tone(out, 3.5, 0.5, 440), 'custom: pure 880 after the fade');
    const dip = db(rms(decode(out, 2.45, 0.1)) / rms(decode(out, 0.5, 1)));
    assert.ok(Math.abs(dip) < 1.5, `custom midpoint dip ${dip.toFixed(2)} dB`);
  }
}
console.log('FB-13 OK: per-transition audio fades (auto/custom/off), aligned, no drift, no unintended gain');
