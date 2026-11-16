// AU-07 — the loudness report is a visible block, not one line: target,
// measured, gain and final numbers with a verdict — and a measurement even
// when mastering is off.
// Usage: node scripts/test-loudness-report.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { loudnessVerdict } from '../src/loudnessReport.js';

const require = createRequire(import.meta.url);
const { measureLoudness } = require('../electron/loudness.cjs');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');

// Verdict rules.
assert.equal(loudnessVerdict({ target: { id: 'social', I: -14, TP: -1 }, final: { integrated: -14.2, truePeak: -1.5, lra: 8, clipped: false } }), 'on-target', 'within ±1 LU of target and under the ceiling is on target');
assert.equal(loudnessVerdict({ target: { id: 'social', I: -14, TP: -1 }, final: { integrated: -14.0, truePeak: -0.4, lra: 8, clipped: true } }), 'over-tp', 'a clipped file is over the ceiling even on target');
assert.equal(loudnessVerdict({ target: { id: 'social', I: -14, TP: -1 }, final: { integrated: -20.0, truePeak: -3.0, lra: 8, clipped: false } }), 'off-target', 'inside the ceiling but 6 LU off target is off target');
assert.equal(loudnessVerdict({ target: null, final: { integrated: -20.0, truePeak: -3.0, lra: 8, clipped: false } }), 'measured-only', 'no target means measurement only');
assert.equal(loudnessVerdict({ target: { id: 'social', I: -14, TP: -1 }, final: null }), null, 'nothing measured is no verdict');
assert.equal(loudnessVerdict({ target: { id: 'social', I: -14, TP: -1 }, final: { integrated: -14.0, truePeak: -1.0, lra: 8, clipped: false } }), 'on-target', 'exactly on the ceiling is still on target');

// A real measurement returns numbers (live loudnorm pass).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-loud-'));
const tone = path.join(dir, 'tone.wav');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone]);
const measured = await measureLoudness(ffmpegPath, tone);
assert.ok(measured && Number.isFinite(measured.integrated) && Number.isFinite(measured.truePeak), `measureLoudness returns integrated + true peak (${measured?.integrated} LUFS, ${measured?.truePeak} dBTP)`);

// Wiring: the done card renders the report block (not the old one-liner),
// and mastering-off still measures — in the video export handler and in
// the audio-only export.
const tray = fs.readFileSync(new URL('../src/components/ExportJobsTray.jsx', import.meta.url), 'utf8');
assert.ok(tray.includes('<LoudnessReport loudness={job.loudness} />'), 'the done card renders the LoudnessReport block');
assert.ok(tray.includes("t('tray.loudnessTarget'") && tray.includes("t('tray.loudnessMeasured'") && tray.includes("t('tray.loudnessGain'") && tray.includes("t('tray.loudnessFinal'"), 'the block shows target, measured, gain and final');
assert.ok(tray.includes("t('tray.loudnessOnTarget'") && tray.includes("t('tray.loudnessOffTarget'") && tray.includes("t('tray.loudnessMeasuredOnly'"), 'the block shows a verdict for every case');
assert.ok(!tray.includes("t('tray.loudness', {"), 'the old one-liner is gone');
const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
assert.ok(main.includes("measureLoudness(ffmpegPath, target.file)") && main.includes('target: null, measured, final: measured'), 'mastering-off video exports still measure');
const ff = fs.readFileSync(new URL('../electron/ffmpeg.cjs', import.meta.url), 'utf8');
assert.ok(ff.includes('target: null, measured: final, final'), 'mastering-off audio exports still measure');
for (const lang of ['en', 'fr', 'ar']) {
  const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
  for (const k of ['"tray.loudnessTitle"', '"tray.loudnessTarget"', '"tray.loudnessMeasured"', '"tray.loudnessGain"', '"tray.loudnessFinal"', '"tray.loudnessOnTarget"', '"tray.loudnessOffTarget"', '"tray.loudnessMeasuredOnly"']) {
    assert.ok(dict.includes(k), `${lang}: ${k}`);
  }
  // test-master-loudness pins these two keys — the report still uses them.
  assert.ok(dict.includes('"tray.loudness"') && dict.includes('"tray.loudnessClipped"'), `${lang}: legacy tray.loudness keys kept`);
}

console.log('loudness-report: all checks passed');
