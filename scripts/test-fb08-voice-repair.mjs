// FB-08 (P1-17) — voice cleanup residual: repair controls + benchmark.
// Repair controls (declick / denoise strength / mains-hum notch) as an
// additive first layer; the De-Hum preset is now a true mains-frequency
// notch (bandreject at 50/60 Hz + harmonics — this ffmpeg build has no
// `anotch`) instead of an EQ dip + highpass + denoise; and a
// speech-intelligibility benchmark across noise types, measured on real
// renders, printed as a table. Run: node scripts/test-fb08-voice-repair.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AUDIO_PRESETS, normalizeAudioFx,
} from '../src/fx/audioPresets.js';
import * as chainR from '../src/fx/audioFxChain.js';
import { audioFxPathOf } from '../src/fx/audioFxPreview.js';

const require = createRequire(import.meta.url);
const {
  audioFxFilters, cleanVoiceChain, humNotchFilters,
  normalizeRepair, repairFilters, hasRepair,
} = require('../electron/audiofx.cjs');
const { buildExportArgs, buildAudioExportArgs, probe, ffmpegPath } = require('../electron/ffmpeg.cjs');
const { renderAudioFx, derivativeFilters } = require('../electron/audiofxrender.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb08-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// ---- 1) Repair units + renderer mirror ----------------------------------------
{
  assert.deepEqual(normalizeRepair(null), { on: false, declick: false, denoise: 0, hum: 'off' });
  assert.deepEqual(normalizeRepair({ on: true, declick: true, denoise: 2, hum: '50' }),
    { on: true, declick: true, denoise: 1, hum: '50' }, 'repair settings clamp into range');
  assert.deepEqual(repairFilters({ on: true, declick: true, denoise: 0.5, hum: '60' }),
    ['adeclick', 'bandreject=f=60:width_type=q:width=8', 'bandreject=f=120:width_type=q:width=8',
     'bandreject=f=180:width_type=q:width=8', 'afftdn=nr=15'],
    'repair chain: declick, hum notch, denoise strength 0.5 -> nr 15');
  assert.deepEqual(repairFilters({ on: false, declick: true }), [], 'repair off is no filter');
  assert.ok(hasRepair({ on: true, hum: 'auto' }) && !hasRepair({ on: true }));
  assert.deepEqual(humNotchFilters('50'),
    ['bandreject=f=50:width_type=q:width=8', 'bandreject=f=100:width_type=q:width=8', 'bandreject=f=150:width_type=q:width=8']);
  assert.equal(humNotchFilters('auto').length, 6, 'auto notches both mains families');
  const corpus = [null, {}, { on: true }, { on: true, declick: true }, { on: true, denoise: 0.7 },
    { on: true, hum: '50' }, { on: true, hum: '60' }, { on: true, hum: 'auto' },
    { on: true, declick: true, denoise: 1, hum: 'auto' }];
  for (const r of corpus) {
    assert.deepEqual(chainR.repairFilters(r), repairFilters(r), `mirror repair matches for ${JSON.stringify(r)}`);
    assert.equal(chainR.hasRepair(r), hasRepair(r), 'mirror hasRepair matches');
    assert.deepEqual(chainR.humNotchFilters('auto'), humNotchFilters('auto'), 'mirror notch matches');
  }
  // The chain carries repair first, then Clean Voice, then audioFx.
  const chain = cleanVoiceChain({ on: true, steps: { enhance: true } }, { eq: { low: 2, mid: 0, high: 0 } },
    { on: true, declick: true });
  assert.ok(chain.startsWith('adeclick,highpass=f=80'), `repair runs first: ${chain}`);
  assert.equal(chain, chainR.cleanVoiceChain({ on: true, steps: { enhance: true } }, { eq: { low: 2, mid: 0, high: 0 } },
    { on: true, declick: true }), 'mirror chain matches with repair');
  assert.deepEqual(derivativeFilters({ eq: { low: 2, mid: 0, high: 0 } }, 2, { on: true, steps: { enhance: true } }, { on: true, declick: true }),
    ['aresample=48000', 'adeclick', 'highpass=f=80', 'equalizer=f=3000:width_type=o:width=1.5:g=2',
     'equalizer=f=100:width_type=o:width=2:g=2'], 'derivative filter order is repair, Clean Voice, audioFx');
}

// ---- 2) De-Hum is now a true mains notch ---------------------------------------
{
  const dehum = AUDIO_PRESETS.find((p) => p.id === 'dehum');
  assert.equal(dehum.fx.humNotch, 'auto', 'dehum preset carries a mains notch');
  assert.equal(normalizeAudioFx(dehum.fx).humNotch, 'auto', 'normalised preset keeps the notch');
  const chain = audioFxFilters(dehum.fx);
  assert.ok(chain.some((f) => f.startsWith('bandreject=f=50')), 'dehum chain notches 50 Hz');
  assert.ok(chain.some((f) => f.startsWith('bandreject=f=60')), 'dehum chain notches 60 Hz');
  assert.deepEqual(chainR.audioFxFilters(dehum.fx), chain, 'mirror dehum chain matches');
}

// ---- 3) Derivative staleness + graph: repair never replaces other settings ----
const cacheDir = path.join(dir, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
// A video fixture with sound, so both the video export and the audio-only
// export have something to carry the repair chain.
const srcWav = path.join(dir, 'src.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-ar', '48000', '-ac', '2', srcWav]);
{
  const rep = { on: true, declick: true, denoise: 0.5, hum: 'auto' };
  const got = await renderAudioFx({ srcPath: srcWav, from: 0, to: 3, fx: {}, cleanVoice: null, repair: rep, channels: 2, cacheDir, ffmpegPath });
  assert.ok(got && got.chain.includes('adeclick') && got.chain.includes('bandreject=f=50'), 'repair derivative carries the repair chain');
  const media = { path: srcWav };
  const clip = { in: 0, out: 3, audioFx: {}, repair: rep, audioFxRender: { path: got.path, from: 0, to: 3, chain: got.chain, src: srcWav } };
  assert.equal(audioFxPathOf(clip, media), got.path, 'repair derivative validates');
  assert.equal(audioFxPathOf({ ...clip, repair: { on: true, declick: false } }, media), null,
    'toggling a repair control invalidates the derivative');
  const plain = await renderAudioFx({ srcPath: srcWav, from: 0, to: 3, fx: { eq: { low: 2, mid: 0, high: 0 } }, cleanVoice: null, channels: 2, cacheDir, ffmpegPath });
  assert.ok(plain && plain.path, 'a clip with repair off but other fx still renders');
}
{
  // A project with repair + Clean Voice + EQ + fades: the graph carries all
  // of them — repair adds, it never silently replaces unrelated settings.
  const media = [{ id: 'm1', path: srcWav, name: 'src.wav', ...(await probe(srcWav)) }];
  const project = {
    name: 'repair', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#000000', media,
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 3, volume: 0.8, fadeIn: 0.5, fadeOut: 0.5, speed: 1,
      muted: false, filter: 'none', adjust: {}, effects: [], transition: null,
      repair: { on: true, declick: true, denoise: 0.5, hum: 'auto' },
      cleanVoice: { on: true, steps: { enhance: true, deesser: true, hum: true, comp: true, duck: false } },
      audioFx: { eq: { low: 2, mid: 0, high: 3 } } }],
    overlayClips: [], textClips: [], audioClips: [],
  };
  const g = buildExportArgs(project, path.join(dir, 'g.mp4')).args.join(' ');
  for (const f of ['adeclick', 'bandreject=f=50', 'afftdn=nr=15', 'highpass=f=80', 'deesser=i=0.5',
    'equalizer=f=100:width_type=o:width=2:g=2', 'equalizer=f=8000:width_type=o:width=2:g=3',
    'afade=t=in', 'afade=t=out', 'volume=0.8']) {
    assert.ok(g.includes(f), `graph keeps ${f}`);
  }
  // buildAudioExportArgs renders the same clip through the audio path.
  const ga = buildAudioExportArgs(project, path.join(dir, 'g.wav'), 'wav').join(' ');
  assert.ok(ga.includes('adeclick') && ga.includes('bandreject=f=60'), 'audio-only export carries repair too');
}

// ---- 4) Intelligibility benchmark across noise types ---------------------------
// Fixtures: formant "speech" (300/700/1200 Hz tones) mixed with each noise
// type at a fixed level. Metrics are Goertzel magnitudes on decoded audio:
// speech-band tone (700 Hz) vs a noise-only band, hum tones, click peaks.
// Speech-intelligibility proxy: the 700 Hz / noise-band ratio (higher =
// the voice stands further out of the noise).
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
const db = (r) => 20 * Math.log10(Math.max(1e-9, r));
const mix = (name, inputs, filter) => {
  const out = path.join(dir, `${name}.wav`);
  const ins = inputs.flatMap((src) => ['-f', 'lavfi', '-i', src]);
  const labels = inputs.map((_, i) => `[${i}:a]`).join('');
  // volume=0.25 after the mix: three full-scale tones + noise would clip
  // s16 otherwise, and clipping would swamp the measurements.
  gen([...ins, '-filter_complex', `${labels}amix=inputs=${inputs.length}:normalize=0${filter ? `,${filter}` : ''},volume=0.25[a]`, '-map', '[a]', '-ar', '48000', '-ac', '2', out]);
  return out;
};
const SPEECH = ['sine=frequency=300:duration=4', 'sine=frequency=700:duration=4', 'sine=frequency=1200:duration=4'];
const fixtures = {
  white: mix('white', [...SPEECH, 'anoisesrc=color=white:duration=4:amplitude=0.35']),
  hum50: mix('hum50', [...SPEECH, 'sine=frequency=50:duration=4']),
  hum60: mix('hum60', [...SPEECH, 'sine=frequency=60:duration=4']),
  rumble: mix('rumble', [...SPEECH, 'anoisesrc=color=brown:duration=4:amplitude=0.5']),
  wind: mix('wind', [...SPEECH, 'anoisesrc=color=white:duration=4:amplitude=0.4'], 'lowpass=f=400'),
};
// Clicks need quiet speech so the impulses stand out: speech at 0.1, clicks
// at 0.9, 0.1 ms wide every 0.37 s. (Mixed into the loud fixture the clicks
// would hide inside the program level and adeclick would have nothing to find.
// 0.1 ms is the realistic width: adeclick is built for sub-millisecond
// impulses — measured -17 dB on tone — while a 1 ms rectangular pulse reads
// as signal to it, -0.3 dB.)
const speechQuiet = mix('speech-quiet', SPEECH, 'volume=0.1');
const clicksWav = path.join(dir, 'clicks.wav');
gen(['-i', speechQuiet, '-f', 'lavfi', '-i', 'aevalsrc=0.9*lt(mod(t\\,0.37)\\,0.0001):duration=4',
  '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0[a]', '-map', '[a]', '-ar', '48000', '-ac', '2', clicksWav]);
fixtures.clicks = clicksWav;
const ALL_CLEAN = { on: true, steps: { enhance: true, deesser: true, hum: true, comp: true, duck: false } };
const REPAIR = { on: true, declick: true, denoise: 0.7, hum: 'auto' };
const renderCase = async (fixture, { cleanVoice, repair, audioFx }) => {
  const media = [{ id: 'm1', path: fixture, name: path.basename(fixture), ...(await probe(fixture)) }];
  const project = {
    name: 'bench', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#000000', media,
    videoClips: [], overlayClips: [], textClips: [],
    audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 4, volume: 1, fadeIn: 0, fadeOut: 0,
      ...(cleanVoice ? { cleanVoice } : {}), ...(repair ? { repair } : {}), ...(audioFx ? { audioFx } : {}) }],
  };
  const out = path.join(dir, `bench-${Math.random().toString(36).slice(2, 8)}.wav`);
  const args = buildAudioExportArgs(project, out, 'wav');
  execFileSync(ffmpegPath, args, { stdio: 'pipe' });
  return decodeAudio(out, 0.5, 3);
};
const rows = [];
// White noise: speech intelligibility proxy before/after cleanup. The
// baseline is a render with no cleanup through the same export path, so
// the bus gain cancels and only the cleanup is measured.
{
  const before = await renderCase(fixtures.white, {});
  const after = await renderCase(fixtures.white, { cleanVoice: ALL_CLEAN, repair: REPAIR });
  const snr = (s) => db(goertzel(s, 700) / goertzel(s, 6000));
  const voice = db(goertzel(after, 700) / goertzel(before, 700));
  rows.push(['white noise', `SNR ${snr(before).toFixed(1)} -> ${snr(after).toFixed(1)} dB`, snr(after) - snr(before)]);
  assert.ok(snr(after) - snr(before) >= 2, `white-noise SNR improves by ${((snr(after) - snr(before))).toFixed(1)} dB`);
  assert.ok(voice >= -3, `700 Hz voice survives cleanup (${voice.toFixed(1)} dB)`);
}
// 50/60 Hz hum: the De-Hum preset (true notch) against hum recordings.
for (const [name, humFreq] of [['hum50', 50], ['hum60', 60]]) {
  const before = await renderCase(fixtures[name], {});
  const dehum = AUDIO_PRESETS.find((p) => p.id === 'dehum');
  const after = await renderCase(fixtures[name], { audioFx: dehum.fx });
  const att = db(goertzel(after, humFreq) / goertzel(before, humFreq));
  const voice = db(goertzel(after, 700) / goertzel(before, 700));
  rows.push([`${name} (dehum preset)`, `hum ${att.toFixed(1)} dB, voice ${voice.toFixed(1)} dB`, -att]);
  assert.ok(att <= -10, `dehum preset cuts ${humFreq} Hz hum by ${(-att).toFixed(1)} dB`);
  assert.ok(voice >= -3, `700 Hz voice survives the dehum notch (${voice.toFixed(1)} dB)`);
  // The repair hum control alone, same fixture.
  const afterR = await renderCase(fixtures[name], { repair: { on: true, hum: String(humFreq) } });
  const attR = db(goertzel(afterR, humFreq) / goertzel(before, humFreq));
  rows.push([`${name} (repair hum ${humFreq})`, `hum ${attR.toFixed(1)} dB`, -attR]);
  assert.ok(attR <= -10, `repair hum notch cuts ${humFreq} Hz hum by ${(-attR).toFixed(1)} dB`);
}
// Rumble + wind: low-band energy before/after cleanup.
for (const name of ['rumble', 'wind']) {
  const before = await renderCase(fixtures[name], {});
  const after = await renderCase(fixtures[name], { cleanVoice: ALL_CLEAN, repair: REPAIR });
  const low = (s) => goertzel(s, 100);
  const drop = db(low(after) / low(before));
  const voice = db(goertzel(after, 700) / goertzel(before, 700));
  rows.push([name, `100 Hz ${drop.toFixed(1)} dB, voice ${voice.toFixed(1)} dB`, -drop]);
  assert.ok(drop <= -2, `${name}: 100 Hz band falls ${(-drop).toFixed(1)} dB`);
  assert.ok(voice >= -3, `${name}: 700 Hz voice survives (${voice.toFixed(1)} dB)`);
}
// Clicks: the declicker must cut the impulsive peaks at least in half.
{
  const before = await renderCase(fixtures.clicks, {});
  const after = await renderCase(fixtures.clicks, { repair: { on: true, declick: true } });
  const peaks = (s) => { let n = 0; for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > 0.4) n++; return n; };
  const pb = peaks(before);
  const pa = peaks(after);
  rows.push(['clicks', `peaks >0.4: ${pb} -> ${pa}`, pb ? 100 * (1 - pa / pb) : 0]);
  assert.ok(pa <= pb * 0.5, `declick cuts click peaks ${pb} -> ${pa}`);
}
console.log('  intelligibility benchmark (speech = 300/700/1200 Hz formants, 3 s window):');
for (const [name, metric] of rows) console.log(`    ${name.padEnd(24)} ${metric}`);
console.log('FB-08 OK: repair controls, dehum is a true mains notch, benchmark green across white/hum/rumble/wind/clicks');
