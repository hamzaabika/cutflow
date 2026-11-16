// FB-05 (P1-11) — "Underwater" low-pass mismatch, fixed.
// The preset table has one source of truth (shared/audioPresets.json); the
// export gate, the slider and preset validation share one cutoff domain
// (OFF = 0, enabled 100–19,999 Hz); every stored cutoff actually filters.
// Proved acoustically, not just by string: a multi-tone fixture through the
// real chain, and white noise through each full preset — Goertzel magnitudes
// per band, before vs after. Run: node scripts/test-fb05-presets-fft.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AUDIO_PRESETS, LOWPASS_MIN, LOWPASS_MAX, LOWPASS_MAX_ENABLED, clampLowpass,
  normalizeAudioFx, activePreset,
} from '../src/fx/audioPresets.js';
import tableJson from '../shared/audioPresets.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const { AUDIO_FX_PRESETS, audioFxFilters } = require('../electron/audiofx.cjs');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const { renderAudioFx } = require('../electron/audiofxrender.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb05-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// ---- 1) One source of truth -------------------------------------------------
assert.deepEqual(AUDIO_PRESETS, tableJson, 'renderer table is the JSON table');
assert.deepEqual(AUDIO_FX_PRESETS, tableJson, 'engine table is the JSON table');
assert.equal(AUDIO_PRESETS.length, 28, `expected 28 presets, got ${AUDIO_PRESETS.length}`);

// ---- 2) The shared cutoff domain --------------------------------------------
assert.equal(LOWPASS_MIN, 100, 'domain opens at 100 Hz');
assert.equal(LOWPASS_MAX_ENABLED, 19999, 'domain tops at 19,999 Hz');
for (const p of AUDIO_PRESETS) {
  const lp = p.fx.lowpass || 0;
  if (lp > 0) assert.ok(lp >= LOWPASS_MIN && lp <= LOWPASS_MAX_ENABLED,
    `${p.id} lowpass ${lp} Hz is outside the shared domain`);
  assert.equal(clampLowpass(lp), lp, `${p.id} lowpass survives normalisation unchanged`);
  assert.equal(activePreset(p.fx)?.id, p.id, `${p.id} still detects itself as active`);
}
assert.deepEqual(
  [clampLowpass(0), clampLowpass(50), clampLowpass(99), clampLowpass(100), clampLowpass(900),
   clampLowpass(19999), clampLowpass(20000), clampLowpass(99999), clampLowpass(-5)],
  [0, 100, 100, 100, 900, 19999, 0, 0, 0], 'clampLowpass maps into the domain');
// The slider is wired to the same constants (not a second hardcoded range).
const afxSrc = fs.readFileSync(new URL('../src/components/AudioFx.jsx', import.meta.url), 'utf8');
assert.ok(afxSrc.includes('min={LOWPASS_MIN}'), 'low-pass slider minimum is the shared constant');
assert.ok(afxSrc.includes('max={LOWPASS_MAX}'), 'low-pass slider maximum is the shared constant');
assert.ok(afxSrc.includes('type="number"'), 'precise numeric frequency entry exists');
assert.ok(!afxSrc.includes('min={4000}'), 'the old 4000 Hz slider floor is gone');
// Every preset still drives real filters through the chain (regression guard
// for the table move — the chain itself is untouched apart from the gate).
for (const p of AUDIO_PRESETS) {
  assert.ok(audioFxFilters(p.fx).length >= 3, `${p.name} drives at least three real filters`);
}

// ---- 3) Acoustic helpers -----------------------------------------------------
// Decode a file to mono f32 and measure a tone's magnitude (Goertzel, Hann).
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
    const x = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    const s = x + 2 * cw * s1 - s2;
    s2 = s1; s1 = s;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * cw * s1 * s2) / n;
};
const db = (ratio) => 20 * Math.log10(Math.max(1e-9, ratio));
const processBuffer = (src, chain, outFile) => {
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-af', ['aresample=48000', ...chain].join(','), '-ar', '48000', '-ac', '2', outFile]);
  return decodeAudio(outFile, 0.5, 2);
};

// ---- 4) The gate: every stored cutoff actually filters -----------------------
// Multi-tone fixture (steady tones, no echo in this chain — the chain under
// test is a bare lowpass, so magnitudes are unambiguous).
const TONES = [200, 300, 600, 1500, 3000, 6000, 12000, 16000];
const toneSrc = path.join(dir, 'tones.wav');
{
  const inputs = TONES.map((f) => ['-f', 'lavfi', '-i', `sine=frequency=${f}:duration=3`]).flat();
  const mix = `${TONES.map((_, i) => `[${i}:a]`).join('')}amix=inputs=${TONES.length}:normalize=0[a]`;
  gen([...inputs, '-filter_complex', mix, '-map', '[a]', '-ar', '48000', '-ac', '2', toneSrc]);
}
const baseTones = decodeAudio(toneSrc, 0.5, 2);
const distinctLp = [...new Set(AUDIO_PRESETS.map((p) => p.fx.lowpass || 0).filter((lp) => lp > 0))].sort((a, b) => a - b);
for (const lp of distinctLp) {
  const fLo = [...TONES].reverse().find((f) => f < lp / 2);
  const fHi = TONES.find((f) => f > 2 * lp) || TONES[TONES.length - 1]; // a tone well above the cutoff, never at it (-3 dB by definition)
  const out = processBuffer(toneSrc, audioFxFilters({ lowpass: lp }), path.join(dir, `lp-${lp}.wav`));
  const attHi = db(goertzel(out, fHi) / goertzel(baseTones, fHi));
  const attLo = db(goertzel(out, fLo) / goertzel(baseTones, fLo));
  assert.ok(attHi <= -6, `lowpass ${lp} Hz: ${fHi} Hz tone attenuated only ${attHi.toFixed(1)} dB`);
  assert.ok(attLo >= -3, `lowpass ${lp} Hz: ${fLo} Hz tone moved ${attLo.toFixed(1)} dB (passband must survive)`);
  console.log(`  lowpass ${String(lp).padStart(5)} Hz: ${fHi} Hz ${attHi.toFixed(1)} dB, ${fLo} Hz ${attLo.toFixed(1)} dB`);
}

// ---- 5) Full presets: the spectral balance moves -----------------------------
// White noise through the whole preset chain (noise is pitch- and
// echo-immune: a pitch shift keeps it flat, an echo adds decorrelated power).
// The high/low band ratio must fall for every preset with a lowpass, and stay
// put for presets without one.
const noiseSrc = path.join(dir, 'noise.wav');
gen(['-f', 'lavfi', '-i', 'anoisesrc=color=white:duration=3:amplitude=0.5', '-ar', '48000', '-ac', '2', noiseSrc]);
const baseNoise = decodeAudio(noiseSrc, 0.5, 2);
const bandRatio = (samples, hi, lo = 300) => goertzel(samples, hi) / goertzel(samples, lo);
for (const p of AUDIO_PRESETS) {
  const lp = p.fx.lowpass || 0;
  if (!lp) continue;
  const hi = Math.min(16000, Math.max(3000, 2 * lp)); // well above the cutoff, never near it
  const out = processBuffer(noiseSrc, audioFxFilters(p.fx), path.join(dir, `noise-${p.id}.wav`));
  const drop = db(bandRatio(out, hi) / bandRatio(baseNoise, hi));
  assert.ok(drop <= -6, `${p.id} (lowpass ${lp}): ${hi}/300 Hz band ratio fell only ${drop.toFixed(1)} dB`);
  console.log(`  ${p.id} (lowpass ${lp}): ${hi}/300 Hz band ratio ${drop.toFixed(1)} dB`);
}
{
  const p = AUDIO_PRESETS.find((x) => x.id === 'clear-voice');
  const out = processBuffer(noiseSrc, audioFxFilters(p.fx), path.join(dir, 'noise-clear.wav'));
  const move = db(bandRatio(out, 6000) / bandRatio(baseNoise, 6000));
  assert.ok(Math.abs(move) < 6, `clear-voice (no lowpass) moved the 6000/300 Hz ratio ${move.toFixed(1)} dB`);
}

// ---- 6) Underwater: preview derivative == final render -----------------------
const uw = AUDIO_PRESETS.find((p) => p.id === 'underwater');
assert.ok(audioFxFilters(uw.fx).includes('lowpass=f=900'), 'underwater chain carries lowpass=f=900');
{
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const got = await renderAudioFx({ srcPath: noiseSrc, from: 0, to: 3, fx: uw.fx, channels: 2, cacheDir, ffmpegPath });
  assert.ok(got && got.path && fs.existsSync(got.path), 'underwater derivative rendered');
  assert.equal(got.chain, audioFxFilters(uw.fx).join(','), 'stored chain is the shared chain');
  const ref = path.join(dir, 'ref-uw.wav');
  gen(['-ss', '0', '-t', '3', '-i', noiseSrc, '-map', '0:a:0', '-vn',
    '-af', ['aresample=48000', ...audioFxFilters(uw.fx)].join(','), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', ref]);
  const a = decodeAudio(got.path, 0, 3);
  const b = decodeAudio(ref, 0, 3);
  assert.equal(a.length, b.length, 'derivative and direct render have the same length');
  let maxAbs = 0;
  for (let i = 0; i < a.length; i++) maxAbs = Math.max(maxAbs, Math.abs(a[i] - b[i]));
  assert.ok(maxAbs <= 0.002, `underwater derivative vs direct render max abs diff ${maxAbs}`);
  console.log(`  underwater derivative == direct render (max abs diff ${maxAbs.toExponential(2)})`);
}
console.log('FB-05 OK: one preset table, shared 100–19999 Hz domain, every stored cutoff filters, preview == export');
