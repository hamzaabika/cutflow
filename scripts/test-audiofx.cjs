// Audio FX: each ffmpeg filter chain renders a generated 440 Hz tone to valid, non-silent output.
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Prefer the bundled ffmpeg-static binary; fall back to a system ffmpeg on dev machines
// where the package's postinstall download never ran. The filter strings under test are identical.
const staticPath = require('ffmpeg-static');
const ffmpeg = staticPath && fs.existsSync(staticPath) ? staticPath : 'ffmpeg';
const { audioFxFilters, hasAudioFx, AUDIO_FX_PRESETS, compParams, limitParams } = require('../electron/audiofx.cjs');

assert.deepEqual(audioFxFilters(null), []);
assert.deepEqual(audioFxFilters({}), []);
assert.deepEqual(audioFxFilters({ eq: { low: 0, mid: 0, high: 0 }, pitch: 0 }), [], 'zeroed fx produce no filters');
assert.ok(hasAudioFx({ comp: true }));

// The new essentials: high-pass, low-pass and loudness normalize render the exact filters.
assert.deepEqual(audioFxFilters({ highpass: 80 }), ['highpass=f=80']);
assert.deepEqual(audioFxFilters({ highpass: 10 }), [], 'a sub-20 Hz high-pass is off, not a filter');
assert.deepEqual(audioFxFilters({ lowpass: 12000 }), ['lowpass=f=12000']);
assert.deepEqual(audioFxFilters({ lowpass: 20000 }), [], 'a 20 kHz low-pass is off, not a filter');
assert.deepEqual(audioFxFilters({ loudnorm: true }), ['loudnorm=I=-14:TP=-1:LRA=11', 'aresample=48000']);
assert.deepEqual(audioFxFilters({ highpass: 5000 }), ['highpass=f=1000'], 'high-pass clamps at 1 kHz');

// Presets: complete fx objects whose chains carry their signature filters.
assert.deepEqual(AUDIO_FX_PRESETS.map((p) => p.name), ['Clear Voice', 'Podcast', 'Warm', 'Bright', 'Radio Voice', 'Narration', 'Interview', 'Deep Voice', 'Bright Voice', 'Phone Voice', 'Whisper', 'Small Room', 'Concert Hall', 'Cathedral', 'Cave Echo', 'Stadium', 'Underwater', 'Clean Up', 'De-Hum', 'Room Fix', 'Tape Rescue', 'Wind Guard', 'Level Rescue', 'Broadcast Loud', 'Gentle Glue', 'Punch', 'Night Mode', 'Max Loudness']); // 4 through Sprint 12; 28 after the 10/10 step-3 preset packs (Filmora merge row 3)
const byId = Object.fromEntries(AUDIO_FX_PRESETS.map((p) => [p.id, p]));
const cv = audioFxFilters(byId['clear-voice'].fx).join(',');
assert.ok(cv.includes('highpass=f=80') && cv.includes('loudnorm=I=-14') && cv.includes('afftdn'), `Clear Voice chain: ${cv}`);
const pod = audioFxFilters(byId.podcast.fx).join(',');
assert.ok(pod.includes('acompressor') && pod.includes('alimiter') && pod.includes('loudnorm=I=-14'), `Podcast chain: ${pod}`);
const warm = audioFxFilters(byId.warm.fx).join(',');
assert.ok(warm.includes('lowpass=f=12000') && !warm.includes('loudnorm'), `Warm chain: ${warm}`);
const bright = audioFxFilters(byId.bright.fx).join(',');
assert.ok(bright.includes('equalizer=f=8000:width_type=o:width=2:g=5') && bright.includes('highpass=f=40'), `Bright chain: ${bright}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afx-'));
const tone = path.join(dir, 'tone.wav');
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '48000', tone]);

const cases = {
  eq: { eq: { low: 6, mid: -4, high: 8 } },
  compressor: { comp: true },
  limiter: { limit: true },
  denoise: { denoise: true },
  echo: { echo: { delay: 150, decay: 0.4 } },
  pitchUp: { pitch: 4 },
  pitchDown: { pitch: -6 },
  highpass: { highpass: 120 },
  lowpass: { lowpass: 6000 },
  loudnorm: { loudnorm: true },
  presetClearVoice: byId['clear-voice'].fx,
  presetPodcast: byId.podcast.fx,
  everything: { eq: { low: 3, mid: 2, high: 3 }, comp: true, limit: true, denoise: true, echo: { delay: 120, decay: 0.25 }, pitch: 2 },
};
for (const [name, fx] of Object.entries(cases)) {
  const chain = audioFxFilters(fx).join(',');
  assert.ok(chain.length > 0, `${name} produced filters`);
  const out = path.join(dir, `${name}.wav`);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tone, '-af', chain, '-ar', '48000', out]);
  assert.ok(fs.statSync(out).size > 1000, `${name} wrote a real file`);
  console.log(`  ${name}: ${chain.slice(0, 90)}${chain.length > 90 ? '…' : ''}`);
}
// Non-silence check via volumedetect stderr for the combined chain.
const { spawnSync } = require('child_process');
const probe = spawnSync(ffmpeg, ['-i', path.join(dir, 'everything.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(probe.stderr || '');
assert.ok(mean, 'volumedetect reported a mean volume');
assert.ok(Number(mean[1]) > -50, `combined chain is not silent (mean ${mean[1]} dB)`);
console.log(`audiofx OK: ${Object.keys(cases).length} chains rendered, combined mean_volume ${mean[1]} dB`);

// ---- P2-21: advanced EQ / compressor / limiter / pan / stereo -----------------
// Chain strings: legacy booleans stay byte-identical; objects carry parameters.
assert.deepEqual(audioFxFilters({ comp: true }), ['acompressor=threshold=0.125:ratio=4:attack=20:release=200:makeup=2'], 'legacy comp unchanged');
assert.deepEqual(audioFxFilters({ limit: true }), ['alimiter=limit=0.95:level=false'], 'legacy limit unchanged');
assert.deepEqual(audioFxFilters({ eqBands: [{ f: 1000, g: -6, q: 1 }] }), ['equalizer=f=1000:width_type=q:width=1:g=-6'], 'parametric band');
assert.deepEqual(audioFxFilters({ eqBands: [{ f: 1000, g: 0, q: 1 }] }), [], 'zero-gain band emits nothing');
assert.deepEqual(audioFxFilters({ eqBands: [{ f: 99999, g: 99, q: 99 }] }), ['equalizer=f=18000:width_type=q:width=10:g=15'], 'band clamps to safe bounds');
assert.deepEqual(audioFxFilters({ comp: { threshold: -30, ratio: 10, attack: 5, release: 100, makeup: 6 } }),
  ['acompressor=threshold=0.032:ratio=10:attack=5:release=100:makeup=1.995'], 'compressor parameters');
assert.deepEqual(audioFxFilters({ comp: { threshold: 99, ratio: 99 } }),
  ['acompressor=threshold=1:ratio=20:attack=20:release=200:makeup=1.259'], 'compressor clamps');
assert.deepEqual(audioFxFilters({ limit: { ceiling: -6 } }), ['alimiter=limit=0.501:level=false'], 'limiter ceiling');
assert.deepEqual(audioFxFilters({ pan: -1 }), ['pan=stereo|c0=1*c0+0*c1|c1=0*c0+0*c1'], 'hard-left pan');
assert.deepEqual(audioFxFilters({ pan: 0, width: 1 }), [], 'neutral pan/width emits nothing');
assert.deepEqual(audioFxFilters({ width: 0 }), ['pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1'], 'mono width');
assert.deepEqual(audioFxFilters({ pan: 2, width: 9 }), ['pan=stereo|c0=0*c0+0*c1|c1=-0.5*c0+1.5*c1'], 'pan/width clamp');

// Sample-level: render and measure per-channel RMS with astats.
const astats = (file) => {
  const r = spawnSync(ffmpeg, ['-i', file, '-af', 'astats=metadata=1:reset=1', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = r.stderr || '';
  const chan = {};
  const re = /Channel: (\d+)[\s\S]*?RMS level dB: (-?[\d.]+|-\s*inf)/g;
  let m;
  while ((m = re.exec(out))) chan[m[1]] = m[2].includes('inf') ? -Infinity : Number(m[2]);
  return chan;
};
const stereo = path.join(dir, 'stereo.wav');
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1',
  '-filter_complex', '[0][1]amerge=inputs=2', '-ar', '48000', stereo]);
const render = (name, fx, src = stereo) => {
  const out = path.join(dir, `${name}.wav`);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-af', audioFxFilters(fx).join(','), '-ar', '48000', out]);
  return out;
};
// Hard-left pan: the right channel goes silent, the left keeps its level.
const panL = astats(render('panLeft', { pan: -1 }));
assert.ok(panL['2'] === -Infinity || panL['2'] < -80, `hard-left pan silences right (got ${panL['2']})`);
assert.ok(panL['1'] > -30, `hard-left pan keeps left (got ${panL['1']})`);
const panR = astats(render('panRight', { pan: 1 }));
assert.ok(panR['1'] === -Infinity || panR['1'] < -80, `hard-right pan silences left (got ${panR['1']})`);
// Width 0 (mono): both channels carry the same mid signal.
const mono = astats(render('widthMono', { width: 0 }));
assert.ok(Math.abs(mono['1'] - mono['2']) < 0.5, `width 0 equalises channels (${mono['1']} vs ${mono['2']})`);
// Parametric band: a -15 dB cut at the tone's own frequency drops it hard.
const tone1k = path.join(dir, 'tone1k.wav');
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-ar', '48000', tone1k]);
const plain1k = astats(tone1k)['1'];
const cut1k = astats(render('eqCut', { eqBands: [{ f: 1000, g: -15, q: 1 }] }, tone1k))['1'];
assert.ok(cut1k < plain1k - 10, `EQ band cut drops 1 kHz by >10 dB (${plain1k} -> ${cut1k})`);
const boost1k = astats(render('eqBoost', { eqBands: [{ f: 1000, g: 12, q: 1 }] }, tone1k))['1'];
assert.ok(boost1k > plain1k + 6, `EQ band boost raises 1 kHz by >6 dB (${plain1k} -> ${boost1k})`);
// Compressor: a hot signal loses more level with the compressor than without.
const hot = path.join(dir, 'hot.wav');
execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-af', 'volume=4', '-ar', '48000', hot]);
const hotPlain = astats(hot)['1'];
const hotComp = astats(render('compHot', { comp: { threshold: -30, ratio: 10, attack: 5, release: 100, makeup: 0 } }, hot))['1'];
assert.ok(hotComp < hotPlain - 3, `compressor tames a hot signal (${hotPlain} -> ${hotComp})`);
// Limiter: a hot signal never exceeds the ceiling (within 1 dB of -6 dBFS peak).
const hotLim = render('limHot', { limit: { ceiling: -6 } }, hot);
const peak = spawnSync(ffmpeg, ['-i', hotLim, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
const maxVol = /max_volume:\s*(-?[\d.]+) dB/.exec(peak.stderr || '');
assert.ok(maxVol && Number(maxVol[1]) <= -5, `limiter caps peaks at the ceiling (max ${maxVol && maxVol[1]} dB)`);
// P2 merge fix: compParams/limitParams are idempotent across the two mirrors —
// an already-normalised (linear) object comes back identical, a dB object
// still converts. (A normalised Clear Voice preset used to re-apply as
// threshold 1 / makeup 1.259.)
assert.deepEqual(compParams({ threshold: 0.125, ratio: 4, attack: 20, release: 200, makeup: 2 }), { threshold: 0.125, ratio: 4, attack: 20, release: 200, makeup: 2 }, 'main compParams keeps linear objects');
assert.ok(Math.abs(compParams({ threshold: -18, ratio: 4, attack: 20, release: 200, makeup: 6 }).threshold - 0.1259) < 0.001, 'main compParams still converts dB objects');
assert.deepEqual(limitParams({ limit: 0.95 }), { limit: 0.95 }, 'main limitParams keeps linear objects');
console.log(`audiofx P2-21 OK: pan L ${panL['1']}/${panL['2']} dB, EQ cut ${plain1k}->${cut1k} dB, comp ${hotPlain}->${hotComp} dB, limiter max ${maxVol[1]} dB`);
console.log(`audiofx P2-21 OK: pan L ${panL['1']}/${panL['2']} dB, EQ cut ${plain1k}->${cut1k} dB, comp ${hotPlain}->${hotComp} dB, limiter max ${maxVol[1]} dB`);
