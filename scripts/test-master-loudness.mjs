// Master loudness (P1-14): the video export's master stage, the target
// profiles, and the loudness report on the done card.
//   1) Pure: resolveLoudnessTarget (defaults, off, custom clamp, invalid id),
//      projectHasAudio, parseLoudnormJson (incl. the silence "-inf" case).
//   2) measureLoudness on real fixtures: a tone measures a finite LUFS,
//      silence measures null (nothing to normalize).
//   3) normalizeLoudness on a LOUD video file: the audio lands on the target
//      (±1.0 LUFS by an independent loudnorm measurement — the report's own
//      numbers are cross-checked, not trusted), the video stream is copied
//      untouched (same codec + size), and the report carries gain/target.
//   4) runAudioExport honours the profile: a podcast target (-16) lands at
//      -16 ±1.0 and the job's loudness getter is filled; loudness 'off'
//      leaves the mix alone (loudness getter null, output stays loud).
//   5) Settings maps agree: resolveExport's loudnessTargetI matches
//      resolveLoudnessTarget's I for every profile (one truth, two readers).
//   6) Wiring: dialog control, effectiveExport passthrough, tray line, the
//      'loudness' phase, preload onExportPhase, main returning loudness.
// Usage: node scripts/test-master-loudness.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const { ffmpegPath, ffprobePath, probe, runAudioExport } = require('../electron/ffmpeg.cjs');
const loud = require('../electron/loudness.cjs');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// Independent loudnorm measurement — the "external meter" the report's
// numbers are checked against (same ffmpeg loudnorm analysis, run fresh).
function integratedLoudness(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/"input_i"\s*:\s*"([^"]+)"/);
  return m ? Number(m[1]) : NaN;
}
function videoInfo(file) {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file]).toString();
  return JSON.parse(out).streams?.[0] || null;
}

// ---------------------------------------------------------------- 1. Pure
{
  const t = loud.resolveLoudnessTarget;
  ok(JSON.stringify(t()) === JSON.stringify({ id: 'social', I: -14, TP: -1, LRA: 11 }), 'target: no settings -> social -14/-1 (the audio-only default)');
  ok(t({ loudness: 'off' }) === null, 'target: off -> null (no stage)');
  ok(t({ loudness: 'podcast' }).I === -16 && t({ loudness: 'podcast' }).LRA === 11, 'target: podcast -> -16 LUFS');
  ok(t({ loudness: 'broadcast' }).I === -23 && t({ loudness: 'broadcast' }).TP === -2 && t({ loudness: 'broadcast' }).LRA === 7, 'target: broadcast -> -23/-2, LRA 7');
  ok(t({ loudness: 'custom', loudnessI: -18 }).I === -18, 'target: custom -18 -> -18');
  ok(t({ loudness: 'custom', loudnessI: -2 }).I === -8, 'target: custom clamps to -8 at the top');
  ok(t({ loudness: 'custom', loudnessI: -99 }).I === -30, 'target: custom clamps to -30 at the bottom');
  ok(t({ loudness: 'nope' }).id === 'social', 'target: unknown id falls back to social');
  const p = { media: [{ id: 'm1', hasAudio: true }, { id: 'm2', hasAudio: false }], videoClips: [], overlayClips: [], audioClips: [] };
  ok(loud.projectHasAudio({ ...p, videoClips: [{ mediaId: 'm1', muted: false }] }) === true, 'hasAudio: an unmuted clip with sound counts');
  ok(loud.projectHasAudio({ ...p, videoClips: [{ mediaId: 'm1', muted: true }] }) === false, 'hasAudio: a muted clip does not count');
  ok(loud.projectHasAudio({ ...p, videoClips: [{ mediaId: 'm2' }] }) === false, 'hasAudio: a clip whose media has no sound does not count');
  ok(loud.projectHasAudio({ ...p, audioClips: [{ mediaId: 'm1' }] }) === true, 'hasAudio: an audio-track clip counts');
  ok(loud.projectHasAudio(p) === false, 'hasAudio: an empty timeline has nothing to master');
  const parsed = loud.parseLoudnormJson('x\n{"input_i" : "-20.12", "input_tp" : "-3.40", "input_lra" : "8.20", "input_thresh" : "-30.45", "target_offset" : "0.00", "linear" : "true"}\ny');
  ok(parsed && parsed.integrated === -20.12 && parsed.truePeak === -3.4 && parsed.lra === 8.2, 'parse: the loudnorm JSON block parses to numbers');
  ok(loud.parseLoudnormJson('{"input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00"}') === null, 'parse: silence ("-inf") is unmeasurable, not -Infinity');
  ok(loud.parseLoudnormJson('no json here') === null, 'parse: no JSON block -> null');
}

// ---------------------------------------------------------------- 2-4. Real files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-loud-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const loudMp4 = path.join(dir, 'loud.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', loudMp4]);
const quietMp4 = path.join(dir, 'quiet.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.1', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', quietMp4]);
const silentWav = path.join(dir, 'silent.wav');
gen(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', silentWav]);

{
  const m = await loud.measureLoudness(ffmpegPath, loudMp4);
  // The lavfi sine source generates at -18 dBFS full-scale, so volume 0.5
  // lands at about -27.9 LUFS — the measurement is what matters, not the
  // volume knob's name.
  ok(m && near(m.integrated, -27.9, 2) && Number.isFinite(m.truePeak) && Number.isFinite(m.lra), `measure: the loud tone reads finite loudness (I ${m?.integrated?.toFixed(2)} LUFS, TP ${m?.truePeak?.toFixed(2)}, LRA ${m?.lra?.toFixed(2)})`);
  const s = await loud.measureLoudness(ffmpegPath, silentWav);
  ok(s === null, 'measure: silence measures null');
}

{
  const before = videoInfo(loudMp4);
  const report = await loud.normalizeLoudness(ffmpegPath, ffprobePath, loudMp4, loud.resolveLoudnessTarget(), { audioKbps: 192 });
  const after = videoInfo(loudMp4);
  ok(report.applied === true, `normalize: the loud file is normalized (gain ${report.gainDb?.toFixed(2)} dB)`);
  ok(near(report.gainDb, 13.9, 1.5), `normalize: the gain is about +13.9 dB for a -27.9 LUFS tone to -14 (got ${report.gainDb?.toFixed(2)})`);
  const ext = integratedLoudness(loudMp4);
  ok(near(ext, -14, 1.0), `normalize: an independent loudnorm measurement lands on the -14 target (got ${ext.toFixed(2)} LUFS)`);
  ok(report.final && near(report.final.integrated, ext, 0.5), `normalize: the report's own final number agrees with the independent measurement (${report.final?.integrated?.toFixed(2)} vs ${ext.toFixed(2)})`);
  ok(report.final && report.final.clipped === false, 'normalize: the delivered file does not clip (true peak under 0 dBTP)');
  ok(after && before && after.codec_name === before.codec_name && after.width === before.width && after.height === before.height,
    `normalize: the video stream is copied untouched (${after?.codec_name} ${after?.width}x${after?.height})`);
  // The quiet tone is -41.8 LUFS, so the gain needed (+27.8) exceeds the
  // ±24 dB clamp: the stage gains the full +24 and the file lands at about
  // -17.8 — the clamp is the honest limit, not a failure to reach the target.
  const quietReport = await loud.normalizeLoudness(ffmpegPath, ffprobePath, quietMp4, loud.resolveLoudnessTarget(), { audioKbps: 192 });
  const extQ = integratedLoudness(quietMp4);
  ok(near(quietReport.gainDb, 24, 0.5) && near(extQ, -17.8, 1.0), `normalize: the too-quiet file gains the full clamped +24 dB and lands at ${extQ.toFixed(2)} LUFS (gain ${quietReport.gainDb?.toFixed(2)})`);
  const silReport = await loud.normalizeLoudness(ffmpegPath, ffprobePath, silentWav, loud.resolveLoudnessTarget(), {});
  ok(silReport.applied === false && silReport.measured === null, 'normalize: silence is left untouched (nothing to measure)');
}

// ---------------------------------------------------------------- Cross-filesystem
// REGRESSION (caught live 2026-11-15): the temp file used to live under
// os.tmpdir() (/tmp, a tmpfs) while exports live on disk — rename(2) failed
// with EXDEV and the stage silently never applied. The temp must live next
// to the target, so a file on a different mount than os.tmpdir() normalizes.
{
  const xfsDir = '/home/hatch/workspace/.tmp-loud-xfs';
  fs.mkdirSync(xfsDir, { recursive: true });
  const xfsFile = path.join(xfsDir, 'loud-xfs.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', xfsFile]);
  const rep = await loud.normalizeLoudness(ffmpegPath, ffprobePath, xfsFile, loud.resolveLoudnessTarget(), { audioKbps: 192 });
  const extX = integratedLoudness(xfsFile);
  ok(rep.applied === true && near(extX, -14, 1.0),
    `normalize: a file on a different mount than os.tmpdir() still normalizes (got ${extX.toFixed(2)} LUFS, gain ${rep.gainDb?.toFixed(2)} dB)`);
  ok(!fs.readdirSync(xfsDir).some((f) => f.startsWith('.fve-loud-')), 'normalize: no temp file left behind next to the target');
  fs.rmSync(xfsDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 4. Audio job profiles
// NOTE: the audio job gets its OWN fixture file — normalizeLoudness (section
// 3) rewrites its input in place, so the section-3 fixtures are no longer
// quiet by the time this section runs.
{
  const { resolveExport } = await import('../src/exportQuality.js');
  const quietMp4b = path.join(dir, 'quiet-b.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.1', '-shortest', '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', quietMp4b]);
  const info = await probe(quietMp4b);
  const media = [{ id: 'm1', path: quietMp4b, name: 'quiet-b.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (loudness, loudnessI) => {
    const p = {
      name: 'loud-test', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010', media,
      videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 4 }],
      overlayClips: [], textClips: [], audioClips: [],
      exportSettings: { preset: 'custom', custom: { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 192 }, loudness, loudnessI },
    };
    p.export = resolveExport(p, { libx265: true, vp9: true });
    return p;
  };
  const pod = path.join(dir, 'pod.mp3');
  const podJob = runAudioExport(mkProject('podcast'), pod, 'mp3', () => {});
  await podJob.promise;
  const podI = integratedLoudness(pod);
  ok(near(podI, -16, 1.0), `audio job: podcast target lands at -16 LUFS (got ${podI.toFixed(2)})`);
  ok(podJob.loudness && podJob.loudness.applied && podJob.loudness.target.id === 'podcast' && near(podJob.loudness.final?.integrated, podI, 0.5),
    'audio job: the loudness getter is filled (applied, target podcast, final agrees with the meter)');
  const off = path.join(dir, 'off.mp3');
  const offJob = runAudioExport(mkProject('off'), off, 'mp3', () => {});
  await offJob.promise;
  const offI = integratedLoudness(off);
  ok(offJob.loudness && !offJob.loudness.applied && offJob.loudness.target === null && near(offJob.loudness.final?.integrated, offI, 0.5),
    'audio job: loudness off -> measurement-only report (not applied, no target, final agrees with the meter)');
  // The mono source measures -41.8 LUFS; the stereo mixdown reads about
  // +2.8 dB hotter (dual-mono), and no master gain is applied.
  ok(near(offI, -39.0, 1.5), `audio job: loudness off leaves the quiet mix alone (got ${offI.toFixed(2)} LUFS, not -14)`);
}

// ---------------------------------------------------------------- 5. Settings maps agree
{
  const { resolveExport } = await import('../src/exportQuality.js');
  for (const [id, want] of [['social', -14], ['podcast', -16], ['broadcast', -23]]) {
    const eff = resolveExport({ width: 320, height: 180, fps: 30, exportSettings: { preset: 'high', loudness: id } }, {});
    ok(eff.loudnessTargetI === want && loud.resolveLoudnessTarget(eff).I === want,
      `maps: resolveExport and resolveLoudnessTarget agree on ${id} (${want} LUFS)`);
  }
  const effOff = resolveExport({ width: 320, height: 180, fps: 30, exportSettings: { preset: 'high', loudness: 'off' } }, {});
  ok(effOff.loudnessTargetI === null && loud.resolveLoudnessTarget(effOff) === null, 'maps: off resolves to null on both sides');
  const effCustom = resolveExport({ width: 320, height: 180, fps: 30, exportSettings: { preset: 'high', loudness: 'custom', loudnessI: -18 } }, {});
  ok(effCustom.loudnessTargetI === -18, 'maps: custom -18 flows through resolveExport');
}

// ---------------------------------------------------------------- 6. Wiring
{
  const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');
  const dialog = read('src/components/ExportDialog.jsx');
  ok(/t\('exp\.loudness'\)/.test(dialog) && /loudness: v/.test(dialog) && /loudnessI: v/.test(dialog),
    'wiring: the Export dialog has the master-loudness control (profile + custom LUFS)');
  const eff = read('electron/ffmpeg.cjs');
  ok(/loudness: \['off', 'social', 'podcast', 'broadcast', 'custom'\]/.test(eff) && /loudnessTargetI/.test(eff),
    'wiring: effectiveExport passes the loudness fields through');
  ok(/require\('\.\/loudness\.cjs'\)/.test(eff), 'wiring: ffmpeg.cjs uses the shared loudness module');
  ok(/get loudness\(\) { return loudnessReport; }/.test(eff), 'wiring: the audio job exposes the loudness report');
  const tray = read('src/components/ExportJobsTray.jsx');
  ok(/<LoudnessReport loudness=\{job\.loudness\} \/>/.test(tray) && /t\('tray\.loudnessTarget'/.test(tray) && /t\('tray\.loudnessFinal'/.test(tray) && /tray\.loudnessClipped/.test(tray),
    'wiring: the done card shows the loudness report block (target, final) and the clipping warning');
  const jobs = read('src/exportJobs.js');
  ok(/id: 'loudness'/.test(jobs) && /projectHasAudio/.test(jobs), 'wiring: videoPhases has the loudness phase, gated on audible sound');
  const preload = read('electron/preload.cjs');
  ok(/onExportPhase/.test(preload) && /export:phase/.test(preload), 'wiring: preload exposes onExportPhase');
  const app = read('src/App.jsx');
  ok(/onExportPhase/.test(app) && /loudness: res\.loudness/.test(app), 'wiring: App flips to the loudness phase and carries the report to the done job');
  const main = read('electron/main.cjs');
  ok(/normalizeLoudness/.test(main) && /loudness: loudnessReport/.test(main) && /export:phase', 'loudness'/.test(main),
    'wiring: main runs the video master stage and returns the report');
  ok(/loudness: currentAudioJob\.loudness/.test(main), 'wiring: main returns the audio job loudness report');
  for (const lang of ['en', 'fr', 'ar']) {
    const cat = read(`src/i18n/${lang}.js`);
    for (const key of ['exp.loudness', 'exp.loudnessOff', 'exp.loudnessSocial', 'exp.loudnessPodcast', 'exp.loudnessBroadcast', 'exp.loudnessCustom', 'exp.loudnessTarget', 'exp.loudnessTargetAria', 'exp.phase.loudness', 'exp.stage.loudness', 'exp.summary.loudnessOff', 'exp.summary.loudnessTarget', 'tray.loudness', 'tray.loudnessClipped']) {
      ok(cat.includes(`"${key}"`), `wiring: ${lang} has ${key}`);
    }
  }
}

if (fails.length) { console.log(`\nMASTER LOUDNESS FAIL (${fails.length})`); process.exit(1); }
console.log('\nMASTER LOUDNESS OK');
