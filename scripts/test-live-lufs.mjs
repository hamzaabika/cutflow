// B-F19 — live LUFS panel: the timeline's loudness as a real EBU R128
// measurement (momentary/short-term curve + integrated + true peak), with
// the export target line and a readout that follows the playhead.
// Usage: node scripts/test-live-lufs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sampleAt } from '../src/loudnessReport.js';

const require = createRequire(import.meta.url);
const { measureLoudness, measureLoudnessCurve, parseEbur128Curve } = require('../electron/loudness.cjs');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');

// The parser, on a canned ebur128 log (frame lines + summary).
const canned = `[Parsed_ebur128_0 @ 0x1] t: 0.100 TARGET:-23 LUFS M:-120.7 S:-120.7 I: -70.0 LUFS LRA: 0.0 LU FTPK: -13.2 dBFS TPK: -13.2 dBFS
[Parsed_ebur128_0 @ 0x1] t: 0.400 TARGET:-23 LUFS M: -18.5 S:-120.7 I: -18.5 LUFS LRA: 0.0 LU FTPK: -13.2 dBFS TPK: -13.2 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:
  Integrated loudness:
    I:         -18.5 LUFS
  Loudness range:
    LRA:         0.0 LU
  True peak:
    Peak:      -13.2 dBFS
`;
const parsed = parseEbur128Curve(canned);
assert.equal(parsed.samples.length, 2, 'the parser keeps the frame samples');
assert.equal(parsed.samples[1].m, -18.5, 'the momentary value parses');
assert.equal(parsed.integrated, -18.5, 'the summary integrated comes from the Summary block, not a frame line');
assert.equal(parsed.truePeak, -13.2, 'the summary true peak parses');
assert.equal(parseEbur128Curve('nothing here'), null, 'a log with no frames and no summary is null');

// A live measurement: a 2 s tone, measured both ways, must agree.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-lufs-'));
const tone = path.join(dir, 'tone.wav');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone]);
const curve = await measureLoudnessCurve(ffmpegPath, tone);
assert.ok(curve && curve.samples.length >= 10, `the curve has samples (${curve?.samples.length})`);
assert.ok(curve.samples.every((s) => s.t >= 0 && s.t <= 2.1), 'sample times stay inside the file');
assert.ok(Number.isFinite(curve.integrated), `the curve carries the integrated value (${curve.integrated})`);
assert.ok(Number.isFinite(curve.truePeak), `the curve carries the true peak (${curve.truePeak})`);
const single = await measureLoudness(ffmpegPath, tone);
assert.ok(Math.abs(curve.integrated - single.integrated) < 1, `curve integrated (${curve.integrated}) agrees with loudnorm (${single.integrated}) within 1 LU`);
assert.ok(Math.abs(curve.truePeak - single.truePeak) < 1, `curve true peak (${curve.truePeak}) agrees with loudnorm (${single.truePeak}) within 1 dB`);

// sampleAt: the readout follows the playhead.
assert.deepEqual(sampleAt(curve, 0.15), curve.samples[0], 'sampleAt takes the sample at or before the playhead');
assert.equal(sampleAt(null, 1), null, 'sampleAt with no curve is null');

// Wiring: handler + preload + panel + toolbar button.
const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
assert.ok(main.includes("ipcMain.handle('audio:loudnessCurve'") && main.includes('measureLoudnessCurve'), 'the main process serves the loudness curve');
const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
assert.ok(preload.includes('loudnessCurve: (project) => ipcRenderer.invoke(\'audio:loudnessCurve\', project)'), 'the preload exposes loudnessCurve');
const panel = fs.readFileSync(new URL('../src/components/LoudnessPanel.jsx', import.meta.url), 'utf8');
assert.ok(panel.includes('window.api.loudnessCurve(project)') && panel.includes('lufs-graph') && panel.includes('sampleAt(curve, time)'), 'the panel analyses, draws the graph, and reads out at the playhead');
const tl = fs.readFileSync(new URL('../src/components/Timeline.jsx', import.meta.url), 'utf8');
assert.ok(tl.includes("t('tl.loudness')") && tl.includes('onOpenLoudness'), 'the timeline toolbar opens the panel');
for (const lang of ['en', 'fr', 'ar']) {
  const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
  for (const k of ['"tl.loudness"', '"lufs.title"', '"lufs.intro"', '"lufs.momentary"', '"lufs.shortTerm"', '"lufs.integrated"', '"lufs.truePeak"', '"lufs.target"', '"lufs.analysing"', '"lufs.error"', '"lufs.empty"', '"lufs.reanalyse"', '"lufs.staleNote"', '"lufs.graphAria"']) {
    assert.ok(dict.includes(k), `${lang}: ${k}`);
  }
}

console.log('live-lufs: all checks passed');
