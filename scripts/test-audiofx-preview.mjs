// AudioFx preview parity (Sprint 1, P0): the preview derivative and the export render
// come from ONE chain definition — electron/audiofx.cjs audioFxFilters. Asserted four ways:
//  1. The renderer's mirror (src/fx/audioFxChain.js) produces byte-identical filter
//     strings to the main-process original across a corpus incl. every preset.
//  2. electron/audiofxrender.cjs renders a fixture through the shared chain; an
//     independent ffmpeg render of the same range through audioFxFilters (with the
//     documented source conditioning written out literally here) matches it
//     sample-for-sample within tolerance: max abs diff <= 0.002, diff RMS <= 0.0005.
//  3. The renderer-side validity rules (src/fx/audioFxPreview.js) accept exactly the
//     renders the export would: same chain, same range, same sound source.
//  4. The export graphs consume a valid derivative as the clip's sound source and do
//     NOT re-apply the chain — and fall back to the inline chain when the stored
//     derivative is stale (fx edited / re-trimmed / rendered from another source).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { audioFxFilters, AUDIO_FX_PRESETS } = require('../electron/audiofx.cjs');
const { renderAudioFx } = require('../electron/audiofxrender.cjs');
const { buildExportArgs, buildAudioExportArgs, probe, ffmpegPath } = require('../electron/ffmpeg.cjs');
const mirror = await import('../src/fx/audioFxChain.js');
const preview = await import('../src/fx/audioFxPreview.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afxprev-'));
const cacheDir = path.join(dir, 'cache');
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// ---- 1. Mirror sync ---------------------------------------------------------------
const corpus = [
  null, {}, { eq: { low: 0, mid: 0, high: 0 }, pitch: 0 },
  { eq: { low: 6, mid: -4, high: 8 } },
  { eq: { low: -20, mid: 20, high: 3.5 }, highpass: 5000, lowpass: 500 },
  { comp: true, limit: true, denoise: true, loudnorm: true },
  { echo: { delay: 20, decay: 0.05 } }, { echo: { delay: 9999, decay: 2 } }, { echo: {} },
  { pitch: 12 }, { pitch: -12 }, { pitch: 3.7 },
  { highpass: 19 }, { highpass: 20 }, { lowpass: 999 }, { lowpass: 1000 }, { lowpass: 20000 },
  ...AUDIO_FX_PRESETS.map((p) => p.fx),
];
for (const fx of corpus) {
  assert.deepEqual(mirror.audioFxFilters(fx), audioFxFilters(fx), `mirror chain mismatch for ${JSON.stringify(fx)}`);
  assert.equal(mirror.hasAudioFx(fx), audioFxFilters(fx).length > 0, `mirror hasAudioFx mismatch for ${JSON.stringify(fx)}`);
}
console.log(`  mirror: ${corpus.length} settings produce identical chains`);

// ---- 2. Derivative render == independent chain render ------------------------------
// 44.1 kHz stereo fixture (two detuned sines), so the render's 48 kHz resample is real.
const srcWav = path.join(dir, 'src.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=3',
  '-filter_complex', '[0][1]amix=inputs=2:weights=0.7 0.3', '-ar', '44100', '-ac', '2', srcWav]);
// Mono fixture for the dual-mono pan branch.
const srcMono = path.join(dir, 'mono.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-ar', '44100', '-ac', '1', srcMono]);

const decode = (file) => execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-']);
function compare(aFile, bFile, label) {
  const a = decode(aFile);
  const b = decode(bFile);
  assert.equal(a.length, b.length, `${label}: frame counts differ (${a.length} vs ${b.length})`);
  let maxAbs = 0;
  let sumSq = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a.readFloatLE(i) - b.readFloatLE(i));
    if (d > maxAbs) maxAbs = d;
    sumSq += d * d;
  }
  const rms = Math.sqrt(sumSq / n);
  assert.ok(maxAbs <= 0.002, `${label}: max abs diff ${maxAbs} exceeds 0.002`);
  assert.ok(rms <= 0.0005, `${label}: diff RMS ${rms} exceeds 0.0005`);
  console.log(`  parity ${label}: max abs diff ${maxAbs.toExponential(2)}, diff RMS ${rms.toExponential(2)}`);
}

const fxCases = [
  ['eq+comp+echo', { eq: { low: 6, mid: -4, high: 8 }, comp: true, echo: { delay: 150, decay: 0.4 } }],
  ['pitch+loudnorm', { pitch: 4, loudnorm: true }],
  ['preset clear-voice', AUDIO_FX_PRESETS[0].fx],
];
for (const [label, fx] of fxCases) {
  const got = await renderAudioFx({ srcPath: srcWav, from: 0.5, to: 2.5, fx, channels: 2, cacheDir, ffmpegPath });
  assert.ok(got && got.path && fs.existsSync(got.path), `${label}: derivative rendered`);
  assert.equal(got.chain, audioFxFilters(fx).join(','), `${label}: stored chain is the shared chain`);
  // The independent render: source conditioning written literally (48 kHz resample),
  // then the chain straight from electron/audiofx.cjs — no audiofxrender code involved.
  const ref = path.join(dir, `ref-${label.replace(/\W+/g, '-')}.wav`);
  gen(['-ss', '0.5', '-t', '2', '-i', srcWav, '-map', '0:a:0', '-vn',
    '-af', ['aresample=48000', ...audioFxFilters(fx)].join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', ref]);
  compare(got.path, ref, label);
  // Cache: a second render is the same file, untouched; an fx change is a new file.
  const mtime = fs.statSync(got.path).mtimeMs;
  const again = await renderAudioFx({ srcPath: srcWav, from: 0.5, to: 2.5, fx, channels: 2, cacheDir, ffmpegPath });
  assert.equal(again.path, got.path, `${label}: cache returns the same path`);
  assert.equal(fs.statSync(got.path).mtimeMs, mtime, `${label}: cache hit does not re-render`);
}
// Mono source: the reference takes the dual-mono pan first, as the export chains do.
{
  const fx = { eq: { high: 5 }, comp: true };
  const got = await renderAudioFx({ srcPath: srcMono, from: 0, to: 2, fx, channels: 1, cacheDir, ffmpegPath });
  const ref = path.join(dir, 'ref-mono.wav');
  gen(['-ss', '0', '-t', '2', '-i', srcMono, '-map', '0:a:0', '-vn',
    '-af', ['pan=stereo|c0=c0|c1=c0', 'aresample=48000', ...audioFxFilters(fx)].join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', ref]);
  compare(got.path, ref, 'mono pan branch');
  const other = await renderAudioFx({ srcPath: srcMono, from: 0, to: 2, fx: { eq: { high: 6 }, comp: true }, channels: 1, cacheDir, ffmpegPath });
  assert.notEqual(other.path, got.path, 'an fx change renders a new derivative');
}
assert.equal(await renderAudioFx({ srcPath: srcWav, from: 0, to: 1, fx: {}, cacheDir, ffmpegPath }), null, 'no fx -> no derivative');

// ---- 3. Renderer-side validity ------------------------------------------------------
{
  const fx = { echo: { delay: 150, decay: 0.4 } };
  const chain = audioFxFilters(fx).join(',');
  const media = { path: srcWav };
  const clip = { in: 1, out: 3, audioFx: fx, audioFxRender: { path: '/tmp/x.wav', from: 1, to: 3, chain, src: srcWav } };
  assert.equal(preview.audioFxPathOf(clip, media), '/tmp/x.wav', 'a current render validates');
  assert.equal(preview.audioFxPathOf({ ...clip, audioFx: { pitch: 2 } }, media), null, 'fx edited -> stale');
  assert.equal(preview.audioFxPathOf({ ...clip, in: 1.5 }, media), null, 're-trimmed -> stale');
  assert.equal(preview.audioFxPathOf({ ...clip, audioFxRender: { ...clip.audioFxRender, src: '/other.wav' } }, media), null, 'other source -> stale');
  // With Voice Enhance on, the derivative must have been rendered FROM the enhanced file.
  const enh = { on: true, path: '/tmp/enh.wav', from: 1, to: 3 };
  assert.equal(preview.audioFxPathOf({ ...clip, enhance: enh, audioFxRender: { ...clip.audioFxRender, src: '/tmp/enh.wav' } }, media), '/tmp/x.wav', 'rendered from the enhanced file validates');
  assert.equal(preview.audioFxPathOf({ ...clip, enhance: enh }, media), null, 'rendered from the raw media is stale while enhance is on');
  assert.deepEqual(preview.audioFxSourceFor({ ...clip, enhance: enh }, media), { srcPath: '/tmp/enh.wav', from: 0, to: 2, channels: 2 });
  console.log('  validity: chain / range / source rules accept and reject as the export does');
}

// ---- 4. Export graphs consume the derivative ----------------------------------------
const vid = path.join(dir, 'vid.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-ar', '44100', vid]);
const mus = path.join(dir, 'music.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-ar', '48000', '-ac', '2', mus]);
const media = [];
for (const [id, p] of [['m1', vid], ['m3', mus]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
const m1 = media[0];
const echoFx = { echo: { delay: 150, decay: 0.4 } };
const loudFx = { loudnorm: true };
const vidRender = await renderAudioFx({ srcPath: vid, from: 1, to: 3, fx: echoFx, channels: m1.channels || 2, cacheDir, ffmpegPath });
const musRender = await renderAudioFx({ srcPath: mus, from: 0, to: 4, fx: loudFx, channels: 2, cacheDir, ffmpegPath });
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const mkProject = (withRenders) => ({
  name: 'afx-parity', ratio: '16:9', resolution: 720, width: 640, height: 480, fps: 30, background: '#101010', media,
  videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 1, out: 3,
    audioFx: echoFx, ...(withRenders ? { audioFxRender: { path: vidRender.path, from: 1, to: 3, chain: vidRender.chain, src: vid } } : {}) }],
  overlayClips: [], textClips: [],
  audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 4, volume: 0.8, fadeIn: 0, fadeOut: 0,
    audioFx: loudFx, ...(withRenders ? { audioFxRender: { path: musRender.path, from: 0, to: 4, chain: musRender.chain, src: mus } } : {}) }],
});
{
  const withFx = buildExportArgs(mkProject(true), path.join(dir, 'out.mp4')).args.join(' ');
  assert.ok(withFx.includes(vidRender.path), 'video export takes the main clip derivative as an input');
  assert.ok(withFx.includes(musRender.path), 'video export takes the audio clip derivative as an input');
  assert.ok(!withFx.includes('aecho'), 'video export does not re-apply the echo chain');
  assert.ok(!withFx.includes('loudnorm=I=-14'), 'video export does not re-apply the loudnorm chain');
  const without = buildExportArgs(mkProject(false), path.join(dir, 'out.mp4')).args.join(' ');
  assert.ok(without.includes('aecho') && without.includes('loudnorm=I=-14'), 'without derivatives the chains apply inline');
  assert.ok(!without.includes(vidRender.path), 'without a stored render the derivative file is not referenced');
  const stale = mkProject(true);
  stale.videoClips[0].audioFxRender = { ...stale.videoClips[0].audioFxRender, chain: 'bogus' };
  const staleArgs = buildExportArgs(stale, path.join(dir, 'out.mp4')).args.join(' ');
  assert.ok(staleArgs.includes('aecho') && !staleArgs.includes(vidRender.path), 'a stale derivative is ignored, chain inline');
  const audioOnly = buildAudioExportArgs(mkProject(true), path.join(dir, 'out.wav'), 'wav').join(' ');
  assert.ok(audioOnly.includes(vidRender.path) && audioOnly.includes(musRender.path), 'audio-only export consumes both derivatives');
  assert.ok(!audioOnly.includes('aecho') && !audioOnly.includes('loudnorm=I=-14'), 'audio-only export does not re-apply the chains');
  console.log('  export: derivatives consumed as sources, chains never applied twice, stale renders ignored');
}
console.log('audiofx-preview OK: preview derivative and export share one chain, end to end');
