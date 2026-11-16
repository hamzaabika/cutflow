// Automatic Export Quality Check (P1-57) — electron/exportqc.cjs +
// src/fx/missingFonts.js + the main/renderer wiring. Run with plain node:
//   node scripts/test-export-qc.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { createRequire } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);
const require = createRequire(import.meta.url);
const qc = require('../electron/exportqc.cjs');
const { missingFontsOf, fontIdsOfClip } = await import('../src/fx/missingFonts.js');
const { videoPhases, audioPhases } = await import('../src/exportJobs.js');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(os.tmpdir(), 'qc-test');
fs.mkdirSync(DIR, { recursive: true });
let n = 0;
const check = async (name, cond) => {
  n += 1;
  const ok = await cond;
  assert.ok(ok, name);
  console.log(`ok ${n} - ${name}`);
};
const ff = (args) => execFileSync(ffmpeg, args, { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
const has = (report, id) => (report.findings || []).find((f) => f.id === id);

// ---- pure verdict logic -------------------------------------------------
const clean = { expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true },
  actual: { video: { width: 320, height: 180, fps: 30 }, duration: 6, hasAudio: true },
  black: [], silence: [], frozen: [], missingFonts: [] };
await check('clean project passes with no findings', (() => {
  const r = qc.verdictOf(clean);
  return r.verdict === 'pass' && r.findings.length === 0;
})());
await check('wrong dimensions fail', qc.verdictOf({ ...clean,
  actual: { ...clean.actual, video: { width: 1920, height: 1080, fps: 30 } } }).verdict === 'fail'
  && has(qc.verdictOf({ ...clean, actual: { ...clean.actual, video: { width: 1920, height: 1080, fps: 30 } } }), 'dims')?.level === 'fail');
await check('fps off by 0.6 fails, by 0.3 passes', (() => {
  const a = qc.verdictOf({ ...clean, actual: { ...clean.actual, video: { width: 320, height: 180, fps: 30.6 } } });
  const b = qc.verdictOf({ ...clean, actual: { ...clean.actual, video: { width: 320, height: 180, fps: 30.3 } } });
  return a.verdict === 'fail' && has(a, 'fps') && b.verdict === 'pass';
})());
await check('duration off by 1 s fails, by 0.4 s passes', (() => {
  const a = qc.verdictOf({ ...clean, actual: { ...clean.actual, duration: 7 } });
  const b = qc.verdictOf({ ...clean, actual: { ...clean.actual, duration: 6.4 } });
  return a.verdict === 'fail' && has(a, 'duration') && b.verdict === 'pass';
})());
await check('missing audio stream fails when sound expected', (() => {
  const r = qc.verdictOf({ ...clean, actual: { ...clean.actual, hasAudio: false } });
  return r.verdict === 'fail' && has(r, 'no-audio')?.level === 'fail';
})());
await check('no audio stream is fine when the project is silent', (() => {
  const r = qc.verdictOf({ ...clean, expected: { ...clean.expected, hasAudio: false }, actual: { ...clean.actual, hasAudio: false } });
  return r.verdict === 'pass' && !has(r, 'no-audio');
})());
await check('whole-file silence fails', (() => {
  const r = qc.verdictOf({ ...clean, silence: [{ start: 0, end: 6 }] });
  return r.verdict === 'fail' && has(r, 'silent-all');
})());
await check('one 2 s silent section warns, does not fail', (() => {
  const r = qc.verdictOf({ ...clean, silence: [{ start: 1, end: 3 }] });
  return r.verdict === 'warn' && has(r, 'silent')?.level === 'warn' && !has(r, 'silent-all');
})());
await check('black run warns below 25%, fails above', (() => {
  const w = qc.verdictOf({ ...clean, black: [{ start: 1, end: 2 }] });
  const f = qc.verdictOf({ ...clean, black: [{ start: 0, end: 2 }] });
  return w.verdict === 'warn' && has(w, 'black')?.level === 'warn'
    && f.verdict === 'fail' && has(f, 'black')?.level === 'fail';
})());
await check('frozen run overlapping a black run is dropped as a duplicate', (() => {
  const r = qc.verdictOf({ ...clean, black: [{ start: 0, end: 2 }], frozen: [{ start: 0, end: 2 }] });
  return has(r, 'black') && !has(r, 'frozen');
})());
await check('frozen run on its own warns', (() => {
  const r = qc.verdictOf({ ...clean, frozen: [{ start: 1, end: 3 }] });
  return r.verdict === 'warn' && has(r, 'frozen')?.level === 'warn';
})());
await check('missing font fails', (() => {
  const r = qc.verdictOf({ ...clean, missingFonts: ['no-such-font-xyz'] });
  return r.verdict === 'fail' && has(r, 'font')?.font === 'no-such-font-xyz';
})());

// ---- log parsing (exact lines the filters print) -----------------------
await check('parseRuns reads black/freeze/silence boundaries', (() => {
  const stderr = [
    '[blackdetect @ 0x1] black_start:0 black_end:2 black_duration:2',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 0',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 2',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 2',
    '[blackdetect @ 0x1] black_start:4 black_end:5.966667 black_duration:1.966667',
    '[silencedetect @ 0x3] silence_start: 1',
    '[silencedetect @ 0x3] silence_end: 3 | silence_duration: 2',
  ].join('\n');
  const { black, silence, frozen } = qc.parseRuns(stderr);
  return black.length === 2 && black[0].start === 0 && black[0].end === 2
    && black[1].start === 4 && Math.abs(black[1].end - 5.966667) < 1e-6
    && silence.length === 1 && silence[0].start === 1 && silence[0].end === 3
    && frozen.length === 1 && frozen[0].start === 0 && frozen[0].end === 2;
})());

// ---- font resolution ----------------------------------------------------
await check('fontIdsOfClip resolves template + duo fonts', (() => {
  const a = fontIdsOfClip({ template: 'cap-classic' });
  const b = fontIdsOfClip({ template: 'cap-redpunch' });
  const c = fontIdsOfClip({ duo: {} });
  return a.length === 1 && a[0] === 'montserrat'
    && b.length === 1 && b[0] === 'playfair'
    && c.includes('inter') && c.includes('playfairbi') && c.includes('cairomed') && c.includes('arefruqaa');
})());
await check('missingFontsOf flags only unknown ids', (() => {
  const missing = missingFontsOf({ textClips: [
    { template: 'cap-classic' },
    { template: 'cap-redpunch' },
    { duo: {} },
    { font: 'no-such-font-xyz' },
    { font: 'arialbd' }, // legacy alias — known, not missing
  ] });
  return missing.length === 1 && missing[0] === 'no-such-font-xyz';
})());

// ---- phases ---------------------------------------------------------------
await check('videoPhases ends with the qc phase', (() => {
  const p = videoPhases({ textClips: [], videoClips: [], overlayClips: [], audioClips: [], media: [] },
    { loudness: 'off', format: 'mp4' }, false);
  return p[p.length - 1].id === 'qc';
})());
await check('audioPhases ends with the qc phase', (() => {
  const p = audioPhases();
  return p[p.length - 1].id === 'qc';
})());

// ---- real files: full checkExport ----------------------------------------
const cleanMp4 = path.join(DIR, 'clean.mp4');
const blackMp4 = path.join(DIR, 'black.mp4');
const blackWarnMp4 = path.join(DIR, 'blackwarn.mp4');
const silentMp4 = path.join(DIR, 'silent.mp4');
const noAudioMp4 = path.join(DIR, 'noaudio.mp4');
const toneWav = path.join(DIR, 'tone.wav');
const silentWav = path.join(DIR, 'silent.wav');
ff(['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-af', 'volume=0.5', '-shortest',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', blackWarnMp4]);
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=0.5', '-shortest',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', cleanMp4]);
ff(['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30:duration=2',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=0.5', '-shortest',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', blackMp4]);
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '6', '-shortest',
  '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', silentMp4]);
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
  '-c:v', 'libx264', '-crf', '18', noAudioMp4]);
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', toneWav]);
ff(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '6', silentWav]);

const base = { ffmpegPath: ffmpeg, ffprobePath: ffprobe };
await check('clean file passes end to end', (async () => {
  const r = await qc.checkExport({ ...base, file: cleanMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true }, missingFonts: [] });
  return r.verdict === 'pass' && r.findings.length === 0 && r.actual.width === 320 && r.actual.hasAudio;
})());
await check('black-gap file fails (4 s black of 6 s) with two black runs at 0 and 4, no frozen duplicate', (async () => {
  const r = await qc.checkExport({ ...base, file: blackMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true }, missingFonts: [] });
  const b = has(r, 'black');
  return r.verdict === 'fail' && b?.level === 'fail' && b.runs.length === 2
    && Math.abs(b.runs[0].start - 0) < 0.01 && Math.abs(b.runs[1].start - 4) < 0.01 && !has(r, 'frozen');
})());
await check('one short black run warns, does not fail', (async () => {
  const r = await qc.checkExport({ ...base, file: blackWarnMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 12, hasAudio: true }, missingFonts: [] });
  const b = has(r, 'black');
  return r.verdict === 'warn' && b?.level === 'warn' && b.runs.length === 1
    && Math.abs(b.runs[0].start - 5) < 0.01 && !has(r, 'frozen');
})());
await check('silent file fails whole-file silence', (async () => {
  const r = await qc.checkExport({ ...base, file: silentMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true }, missingFonts: [] });
  return r.verdict === 'fail' && has(r, 'silent-all');
})());
await check('audio-less file fails when sound expected', (async () => {
  const r = await qc.checkExport({ ...base, file: noAudioMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true }, missingFonts: [] });
  return r.verdict === 'fail' && has(r, 'no-audio');
})());
await check('wrong expected dimensions fail on the real file', (async () => {
  const r = await qc.checkExport({ ...base, file: cleanMp4,
    expected: { width: 1920, height: 1080, fps: 30, duration: 6, hasAudio: true }, missingFonts: [] });
  return r.verdict === 'fail' && has(r, 'dims');
})());
await check('missing font fails on the real file', (async () => {
  const r = await qc.checkExport({ ...base, file: cleanMp4,
    expected: { width: 320, height: 180, fps: 30, duration: 6, hasAudio: true }, missingFonts: ['ghost-font'] });
  return r.verdict === 'fail' && has(r, 'font')?.font === 'ghost-font';
})());
await check('audio export: tone wav passes, silent wav fails', (async () => {
  const a = await qc.checkExport({ ...base, file: toneWav,
    expected: { kind: 'audio', duration: 6, hasAudio: true }, missingFonts: [] });
  const b = await qc.checkExport({ ...base, file: silentWav,
    expected: { kind: 'audio', duration: 6, hasAudio: true }, missingFonts: [] });
  return a.verdict === 'pass' && b.verdict === 'fail' && has(b, 'silent-all');
})());

// ---- wiring ---------------------------------------------------------------
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mainCjs = read('electron/main.cjs');
const appJsx = read('src/App.jsx');
const trayJsx = read('src/components/ExportJobsTray.jsx');
await check('main runs the check in export:run and export:audio', mainCjs.includes("require('./exportqc.cjs').checkExport")
  && mainCjs.includes("win.webContents.send('export:phase', 'qc')")
  && /loudness: loudnessReport, qc: qcReport/.test(mainCjs)
  && /loudness: currentAudioJob\.loudness \|\| null, qc: qcReport/.test(mainCjs));
await check('renderer attaches expectations + missing fonts and passes qc to the done job', appJsx.includes('toExport.qcExpected')
  && appJsx.includes('toExport.qcMissingFonts = missingFontsOf(project)')
  && appJsx.includes('qc: res.qc || null')
  && appJsx.includes("phase === 'loudness' || phase === 'qc'"));
await check('tray renders the QC report on the done card', trayJsx.includes('QcReport') && trayJsx.includes('{job.qc && <QcReport qc={job.qc} />}'));
const QC_KEYS = ['exp.phase.qc', 'exp.stage.qc', 'tray.qcPass', 'tray.qcWarn', 'tray.qcFail', 'tray.qcDims',
  'tray.qcFps', 'tray.qcDuration', 'tray.qcNoAudio', 'tray.qcSilentAll', 'tray.qcBlack', 'tray.qcFrozen',
  'tray.qcSilent', 'tray.qcFont'];
await check('all 15 QC i18n keys exist in en, fr and ar', QC_KEYS.every((k) =>
  ['en', 'fr', 'ar'].every((lang) => read(`src/i18n/${lang}.js`).includes(`"${k}"`))));

console.log(`EXPORT QC OK (${n} checks)`);
