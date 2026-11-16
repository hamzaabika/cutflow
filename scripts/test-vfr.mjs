// VFR detection + exact frame-rate retention (P1-25).
// Usage: node scripts/test-vfr.mjs
// Generates a real VFR file (irregular frame selection, -vsync vfr) and a CFR
// file, then asserts probe() keeps the exact rational/float/timebase next to
// the rounded UI fps, flags only the VFR file, and that the enhancer's
// exactFps agrees with the probe instead of re-deriving a second answer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { exactFps } = require('../electron/esrgan.cjs');

const dir = mkdtempSync(join(tmpdir(), 'cutflow-vfr-'));
const vfrFile = join(dir, 'vfr.mp4');
const cfrFile = join(dir, 'cfr.mp4');
try {
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  gen(['-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x360:rate=30',
    '-vf', "select='eq(n,0)+eq(n,1)+eq(n,2)+eq(n,20)+eq(n,21)+eq(n,50)+eq(n,51)+eq(n,52)+eq(n,53)+eq(n,100)+eq(n,150)'",
    '-vsync', 'vfr', vfrFile]);
  gen(['-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x360:rate=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', cfrFile]);

  const vfr = await probe(vfrFile);
  const cfr = await probe(cfrFile);

  // VFR file: avg 165/28 (~5.89) against nominal 30/1 -> flagged.
  assert.equal(vfr.vfr, true, 'VFR file must be flagged');
  assert.equal(vfr.fpsRational, '165/28');
  assert.ok(Math.abs(vfr.fpsExact - 165 / 28) < 1e-9, `fpsExact ${vfr.fpsExact}`);
  assert.equal(vfr.rFrameRate, 30);
  assert.ok(vfr.timeBase.length > 0, 'timeBase kept');
  assert.equal(vfr.fps, 6, 'rounded UI fps unchanged (5.89 -> 6)');

  // CFR file: avg == nominal -> not flagged, exact == rounded.
  assert.equal(cfr.vfr, false, 'CFR file must not be flagged');
  assert.equal(cfr.fpsRational, '30/1');
  assert.equal(cfr.fpsExact, 30);
  assert.equal(cfr.rFrameRate, 30);
  assert.equal(cfr.fps, 30);

  // Enhancer reads the same exact rate the probe kept (no second derivation).
  const vfrExact = await exactFps(vfrFile);
  const cfrExact = await exactFps(cfrFile);
  assert.ok(Math.abs(vfrExact.value - vfr.fpsExact) < 1e-9, `exactFps ${vfrExact.value} vs probe ${vfr.fpsExact}`);
  assert.equal(vfrExact.str, '165/28');
  assert.equal(cfrExact.value, 30);
  assert.equal(cfrExact.str, '30/1');

  console.log('VFR OK');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
