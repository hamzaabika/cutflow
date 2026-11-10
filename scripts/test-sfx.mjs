// Bundled SFX (10/10 step 3): the synthesized sound-effects library is real, decodable,
// audible and consistent — registry, manifest and files on disk all agree.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { SFX_CATS, SFX_ITEMS } from '../src/sfx.js';

const require = createRequire(import.meta.url);
const ff = require('../electron/ffmpeg.cjs');
const root = path.join(import.meta.dirname, '..');
const dir = path.join(root, 'shared', 'sfx');

assert.ok(SFX_ITEMS.length >= 30, `bundled SFX library carries 30+ sounds (got ${SFX_ITEMS.length})`);
const ids = new Set(); const names = new Set();
for (const it of SFX_ITEMS) {
  assert.ok(!ids.has(it.id), `duplicate SFX id ${it.id}`); ids.add(it.id);
  assert.ok(!names.has(it.name), `duplicate SFX name ${it.name}`); names.add(it.name);
  assert.ok(SFX_CATS.includes(it.cat), `${it.id} sits in a real category (${it.cat})`);
  assert.ok(it.file === `${it.id}.mp3`, `${it.id} file name follows the registry id`);
  assert.ok(typeof it.dur === 'number' && it.dur > 0, `${it.id} carries a probed duration`);
}
for (const cat of SFX_CATS) {
  assert.ok(SFX_ITEMS.filter((i) => i.cat === cat).length >= 3, `${cat} shelf carries at least 3 sounds`);
}

// The generator's manifest agrees with the registry, entry for entry.
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.items.map((i) => i.id), SFX_ITEMS.map((i) => i.id), 'manifest and registry list the same sounds in the same order');

// Every file exists, decodes, is short, matches its registered duration, and is
// actually audible (RMS level well above digital silence).
for (const it of SFX_ITEMS) {
  const file = path.join(dir, it.file);
  assert.ok(fs.existsSync(file), `${it.file} exists in shared/sfx`);
  const meta = await ff.probe(file);
  assert.ok(meta.duration > 0.03 && meta.duration <= 3, `${it.id} duration is sane (${meta.duration}s)`);
  assert.ok(Math.abs(meta.duration - it.dur) <= 0.2, `${it.id} registered duration ${it.dur} matches the file (${meta.duration.toFixed(2)})`);
  const stats = spawnSync(ff.ffmpegPath, ['-hide_banner', '-i', file, '-af', 'astats=metadata=1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const rms = /RMS level dB: (-?[\d.]+)/.exec(stats);
  assert.ok(rms && Number(rms[1]) > -55, `${it.id} is audible (RMS ${rms ? rms[1] : '?'} dB)`);
}
console.log(`sfx ok: ${SFX_ITEMS.length} bundled sounds across ${SFX_CATS.length} shelves — files decode, durations sane, panel data valid`);
