// P2-25 One-click Clean Voice: additive voice cleanup (enhance, de-esser,
// hum removal, compressor, music ducking) that never replaces volume, fades,
// Voice Enhance or the clip's own audioFx; the derivative chain key includes
// Clean Voice, so toggling a step invalidates a stored render.
// Usage: node scripts/test-p2b-cleanvoice.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  cleanVoiceFilters, hasCleanVoice, cleanVoiceChain,
} from '../src/fx/audioFxChain.js';

const require = createRequire(import.meta.url);
const {
  cleanVoiceFilters: cvFiltersCjs, hasCleanVoice: hasCvCjs, cleanVoiceChain: chainCjs,
  cleanVoiceDuckSpans, duckVolumeExpr,
} = require('../electron/audiofx.cjs');
const { buildExportArgs, probe, ffmpegPath, runExport, audioFxPathOf } = require('../electron/ffmpeg.cjs');
const { renderAudioFx } = require('../electron/audiofxrender.cjs');

const ALL = { on: true, steps: { enhance: true, deesser: true, hum: true, comp: true, duck: true } };
const step = (id) => ({ on: true, steps: { [id]: true } });

// ---- 1) Filter selection + order ----------------------------------------------
{
  assert.deepEqual(cvFiltersCjs(null), []);
  assert.deepEqual(cvFiltersCjs({ on: false, steps: { hum: true } }), []);
  assert.deepEqual(cvFiltersCjs({ on: true, steps: {} }), []);
  assert.deepEqual(cvFiltersCjs(step('duck')), [], 'duck is not a voice filter');
  assert.deepEqual(cvFiltersCjs(step('enhance')), ['highpass=f=80', 'equalizer=f=3000:width_type=o:width=1.5:g=2']);
  assert.deepEqual(cvFiltersCjs(step('deesser')), ['deesser=i=0.5']);
  assert.deepEqual(cvFiltersCjs(step('hum')), ['equalizer=f=50:width_type=q:width=8:g=-18', 'equalizer=f=100:width_type=q:width=8:g=-12']);
  assert.deepEqual(cvFiltersCjs(step('comp')), ['acompressor=threshold=0.087:ratio=3:attack=10:release=150:makeup=3']);
  const all = cvFiltersCjs(ALL);
  assert.equal(all.length, 6, 'all four filter steps on (2 enhance + 1 deesser + 2 hum + 1 comp)');
  const idx = (s) => all.findIndex((f) => f.startsWith(s));
  assert.ok(idx('highpass') < idx('deesser') && idx('deesser') < idx('equalizer=f=50') && idx('equalizer=f=50') < idx('acompressor'),
    'cleanup order: enhance, de-esser, hum, compressor');
  assert.ok(hasCvCjs(ALL) && !hasCvCjs(step('duck')) && !hasCvCjs(null));
  assert.equal(chainCjs(ALL, { comp: true }),
    [...cvFiltersCjs(ALL), 'acompressor=threshold=0.125:ratio=4:attack=20:release=200:makeup=2'].join(','),
    'chain is Clean Voice first, then the clip audioFx');
  // Renderer mirror stays byte-identical across a corpus.
  const corpus = [null, {}, { on: true, steps: {} }, step('enhance'), step('hum'), ALL, { on: true, steps: { enhance: true, comp: true } }];
  for (const cv of corpus) {
    assert.deepEqual(cleanVoiceFilters(cv), cvFiltersCjs(cv), `mirror matches for ${JSON.stringify(cv)}`);
    assert.equal(cleanVoiceChain(cv, { denoise: true }), chainCjs(cv, { denoise: true }), 'mirror chain matches');
    assert.equal(hasCleanVoice(cv), hasCvCjs(cv), 'mirror hasCleanVoice matches');
  }
}

// ---- 2) Duck spans + expression -----------------------------------------------
{
  const vs = (id) => ({ c1: 0.5, c2: 2.5 }[id]);
  const spans = cleanVoiceDuckSpans(
    [
      { id: 'c1', in: 0, out: 2, cleanVoice: { on: true, steps: { duck: true } } },
      { id: 'c2', in: 0, out: 1, cleanVoice: { on: true, steps: { duck: false } } },
      { id: 'c3', in: 0, out: 1, cleanVoice: { on: true, steps: { duck: true } }, muted: true },
      { id: 'c4', in: 0, out: 1 },
    ],
    [{ id: 'a1', start: 3, in: 0, out: 2, cleanVoice: { on: true, steps: { duck: true } } }],
    vs,
  );
  assert.deepEqual(spans, [
    { start: 0.5, end: 2.5, id: 'c1' },
    { start: 3, end: 5, id: 'a1' },
  ], 'only duck-on, unmuted voices contribute, with their source id');
  assert.equal(duckVolumeExpr([]), null);
  assert.equal(duckVolumeExpr([[0.5, 2.5]]), "volume='1-0.65*clip((t-0.35)/0.15,0,1)*clip((2.65-t)/0.15,0,1)':eval=frame");
  assert.match(duckVolumeExpr([[0.5, 2.5], [3, 5]]), /max\(clip.*clip.*\)/, 'multiple spans take the max');
}

// ---- 3) Derivative staleness + render ------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cleanvoice-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const cacheDir = path.join(dir, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const voice = path.join(dir, 'voice.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-ar', '48000', '-ac', '2', voice]);
const music = path.join(dir, 'music.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-ar', '48000', '-ac', '2', music]);
const media = [];
for (const [id, p] of [['m1', voice], ['m3', music]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
{
  const clip = { ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2, cleanVoice: ALL, audioFx: { comp: true } };
  const m = media[0];
  // A render recorded before Clean Voice was turned on (chain = audioFx only)
  // is stale: the export must not reuse it.
  const staleWav = path.join(dir, 'stale.wav');
  fs.writeFileSync(staleWav, Buffer.alloc(16));
  const stale = { path: staleWav, from: 0, to: 2, chain: 'acompressor=threshold=0.125:ratio=4:attack=20:release=200:makeup=2', src: voice };
  assert.equal(audioFxPathOf({ ...clip, audioFxRender: stale }, m), null, 'old-chain derivative is stale once Clean Voice is on');
  const fresh = await renderAudioFx({ srcPath: voice, from: 0, to: 2, fx: { comp: true }, cleanVoice: ALL, channels: 2, cacheDir, ffmpegPath });
  assert.ok(fresh && fresh.chain.includes('deesser=i=0.5') && fresh.chain.includes('highpass=f=80'), 'render chain carries Clean Voice');
  assert.ok(fs.existsSync(fresh.path), 'derivative file exists');
  assert.equal(audioFxPathOf({ ...clip, audioFxRender: { path: fresh.path, from: 0, to: 2, chain: fresh.chain, src: voice } }, m), fresh.path,
    'a derivative rendered with Clean Voice validates');
  const plain = await renderAudioFx({ srcPath: voice, from: 0, to: 2, fx: { comp: true }, channels: 2, cacheDir, ffmpegPath });
  assert.notEqual(plain.path, fresh.path, 'toggling Clean Voice changes the derivative file');
}

// ---- 4) Graphs: additive with audioFx, duck on the music -----------------------
const mkProject = (voiceCv, musicDuckVoice = false) => ({
  name: 'cleanvoice', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#101010', media,
  videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0.5, out: 1.5, cleanVoice: voiceCv, audioFx: { eq: { low: 0, mid: 2, high: 0 } } }],
  overlayClips: [], textClips: [],
  audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 4, volume: 0.5, fadeIn: 0, fadeOut: 0 }],
});
{
  const g = buildExportArgs(mkProject(ALL), path.join(dir, 'g.mp4')).args.join(' ');
  assert.ok(g.includes('highpass=f=80') && g.includes('deesser=i=0.5'), 'Clean Voice filters are in the graph');
  assert.ok(g.includes('equalizer=f=1000:width_type=o:width=2:g=2'), 'the clip audioFx EQ is still there — Clean Voice did not replace it');
  assert.ok(g.includes("volume='1-0.65*"), 'the music is ducked under the voice span');
  const noDuck = buildExportArgs(mkProject({ on: true, steps: { enhance: true, duck: false } }), path.join(dir, 'g2.mp4')).args.join(' ');
  assert.ok(!noDuck.includes("volume='1-0.65*"), 'duck off means no duck volume');
  const off = buildExportArgs(mkProject(null), path.join(dir, 'g3.mp4')).args.join(' ');
  assert.ok(!off.includes('highpass=f=80') && !off.includes('deesser'), 'Clean Voice off leaves the graph alone');
}

// ---- 5) Real renders: hum removal + ducking, measured ---------------------------
// Goertzel magnitude at a frequency over a window of decoded f32 mono audio.
const decodeAudio = (file, from, len) => {
  const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-vn', '-ss', String(from), '-t', String(len), '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
  const n = raw.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw.readFloatLE(i * 4);
  return out;
};
const goertzel = (samples, freq, sr = 48000) => {
  const n = samples.length;
  const k = Math.round((n * freq) / sr);
  const w = (2 * Math.PI * k) / n;
  const cw = Math.cos(w);
  let s1 = 0; let s2 = 0;
  for (let i = 0; i < n; i++) {
    // Hann window keeps the 440 Hz voice out of the 50 Hz bin (and vice versa).
    const x = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    const s = x + 2 * cw * s1 - s2;
    s2 = s1; s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / n;
};
// Hum fixture: 440 Hz voice + 50 Hz mains hum, as one video file's audio.
const hum = path.join(dir, 'hum.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=50:duration=2',
  '-filter_complex', '[1:a]volume=0.5[v];[2:a]volume=0.3[h];[v][h]amix=inputs=2:normalize=0[a]',
  '-map', '0:v', '-map', '[a]', '-shortest', '-ar', '48000', '-ac', '2', hum]);
const humMedia = [{ id: 'mh', path: hum, name: 'hum.mp4', ...(await probe(hum)) }];
const humProject = (cv) => ({
  name: 'hum', ratio: '16:9', width: 160, height: 90, fps: 30, background: '#000000', media: humMedia,
  videoClips: [{ ...base, id: 'c1', mediaId: 'mh', in: 0, out: 2, cleanVoice: cv }],
  overlayClips: [], textClips: [], audioClips: [],
});
const humOff = path.join(dir, 'hum-off.mp4');
const humOn = path.join(dir, 'hum-on.mp4');
await runExport(humProject(null), humOff, null).promise;
await runExport(humProject({ on: true, steps: { hum: true } }), humOn, null).promise;
{
  const off = decodeAudio(humOff, 0.3, 1.4);
  const on = decodeAudio(humOn, 0.3, 1.4);
  const humRatio = goertzel(on, 50) / goertzel(off, 50);
  const voiceRatio = goertzel(on, 440) / goertzel(off, 440);
  assert.ok(humRatio < 0.6, `hum step cuts the 50 Hz hum (ratio ${humRatio.toFixed(2)})`);
  assert.ok(voiceRatio > 0.7, `the 440 Hz voice survives the hum notch (ratio ${voiceRatio.toFixed(2)})`);
}
// Ducking fixture: voice 0.5–1.5 s, music 0–4 s. A gap clip pads the video
// track to 4 s — the mix is duration=first (the video track), so without it
// the music past the voice would be cut off.
const duckProject = (duckOn) => ({
  name: 'duck', ratio: '16:9', width: 160, height: 90, fps: 30, background: '#000000', media,
  videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0.5, out: 1.5,
    cleanVoice: duckOn ? { on: true, steps: { duck: true } } : null },
  { id: 'g1', gap: true, in: 0, out: 2.5, speed: 1 }],
  overlayClips: [], textClips: [],
  audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 4, volume: 0.5, fadeIn: 0, fadeOut: 0 }],
});
const duckOnFile = path.join(dir, 'duck-on.mp4');
const duckOffFile = path.join(dir, 'duck-off.mp4');
await runExport(duckProject(true), duckOnFile, null).promise;
await runExport(duckProject(false), duckOffFile, null).promise;
{
  const ratio = (file) => {
    const inSpan = decodeAudio(file, 0.3, 0.6);
    const outSpan = decodeAudio(file, 2.5, 1.0);
    return goertzel(inSpan, 880) / goertzel(outSpan, 880);
  };
  const rOn = ratio(duckOnFile);
  const rOff = ratio(duckOffFile);
  assert.ok(rOn > 0.2 && rOn < 0.55, `ducked music is ~0.35x under the voice (ratio ${rOn.toFixed(2)})`);
  assert.ok(rOff > 0.85, `without ducking the music stays level (ratio ${rOff.toFixed(2)})`);
}
console.log('P2-25 Clean Voice OK');
