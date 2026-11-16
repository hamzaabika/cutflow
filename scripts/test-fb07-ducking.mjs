// FB-07 (P1-12) — standalone music ducking against dialogue.
// A music clip's own duck settings (amount / fade / sensitivity) plus
// editable keyframes, replacing the fixed 0.35x Clean Voice duck for that
// clip when on. Keyframes are source-time (volKeys convention) so they
// survive cuts; without manual keys the expression re-derives from the
// live timeline on every export. Run: node scripts/test-fb07-ducking.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { splitClipAtTimes } from '../src/store.js';
import * as duckR from '../src/fx/ducking.js';

const require = createRequire(import.meta.url);
const {
  normalizeDuck, dialogueSpans, filterDuckSpans, duckKeysFromSpans,
  duckKeysExpr, standaloneDuckFilters, cleanVoiceDuckSpans, duckVolumeExpr,
} = require('../electron/audiofx.cjs');
const { buildExportArgs, buildAudioExportArgs, probe, ffmpegPath, runExport } = require('../electron/ffmpeg.cjs');

const vs = (id) => ({ c1: 0.5, c2: 2.5 }[id]);
const voiceCv = { id: 'c1', in: 0, out: 2, cleanVoice: { on: true, steps: { duck: true } } };
const voiceCvOff = { id: 'c2', in: 0, out: 1, cleanVoice: { on: true, steps: { duck: false } } };
const dlgAudio = { id: 'a9', role: 'dialogue', start: 3, in: 0, out: 2 };
const musicAudio = { id: 'a1', role: 'music', start: 0, in: 0, out: 4 };

// ---- 1) Normalisation + dialogue spans ---------------------------------------
{
  assert.deepEqual(normalizeDuck(null), { on: false, to: 0.35, fade: 0.15, sensitivity: 0.75 });
  assert.deepEqual(normalizeDuck({ on: true, to: 2, fade: 0, sensitivity: -1 }),
    { on: true, to: 0.9, fade: 0.05, sensitivity: 0 }, 'duck settings clamp into range');
  assert.deepEqual(normalizeDuck({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.5 }),
    { on: true, to: 0.2, fade: 0.3, sensitivity: 0.5 });
  const spans = dialogueSpans([voiceCv, voiceCvOff], [dlgAudio, musicAudio], vs);
  assert.deepEqual(spans, [
    { start: 0.5, end: 2.5, id: 'c1' },
    { start: 3, end: 5, id: 'a9' },
  ], 'dialogue spans are Clean Voice duck spans + dialogue-role audio (music excluded, muted/duck-off excluded)');
  assert.deepEqual(dialogueSpans([voiceCv], [{ ...dlgAudio, id: 'c1' }], vs),
    [{ start: 0.5, end: 2.5, id: 'c1' }], 'a clip counted once even if it qualifies twice');
  // Renderer mirror agrees.
  assert.deepEqual(duckR.dialogueSpans([voiceCv, voiceCvOff], [dlgAudio, musicAudio], vs), spans, 'renderer dialogueSpans matches');
  assert.deepEqual(duckR.normalizeDuck({ on: true, to: 2, fade: 0, sensitivity: -1 }),
    normalizeDuck({ on: true, to: 2, fade: 0, sensitivity: -1 }), 'renderer normalizeDuck matches');
}

// ---- 2) Sensitivity: short speech may not duck --------------------------------
{
  const spans = [{ start: 1, end: 1.1, id: 's' }, { start: 2, end: 3, id: 'l' }];
  assert.deepEqual(filterDuckSpans(spans, 0.75).map((s) => s.id), ['l'],
    'at sensitivity 0.75 a 0.1 s blip is ignored (min span 0.25 s)');
  assert.deepEqual(filterDuckSpans(spans, 1).map((s) => s.id), ['s', 'l'],
    'at sensitivity 1.0 every span ducks');
  assert.deepEqual(filterDuckSpans(spans, 0).map((s) => s.id), ['l'],
    'at sensitivity 0 only spans >= 1 s duck');
  assert.deepEqual(duckR.filterDuckSpans(spans, 0.75), filterDuckSpans(spans, 0.75), 'renderer filter matches');
}

// ---- 3) Derived keyframes ------------------------------------------------------
{
  const clip = { id: 'a1', start: 0, in: 0, out: 4 };
  const keys = duckKeysFromSpans([{ start: 0.5, end: 1.5, id: 'c1' }], clip, { on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 });
  assert.deepEqual(keys, [
    { t: 0.2, v: 1 }, { t: 0.5, v: 0.2 }, { t: 1.5, v: 0.2 }, { t: 1.8, v: 1 },
  ], 'one span becomes a 1 -> to -> 1 keyframe ramp with fade edges');
  assert.deepEqual(duckR.duckKeysFromSpans([{ start: 0.5, end: 1.5, id: 'c1' }], clip, { on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 }), keys,
    'renderer key derivation matches');
  // A span clipped by the music clip's range, and two overlapping spans merging.
  const clipped = duckKeysFromSpans([{ start: 3.5, end: 5, id: 'c1' }], clip, { on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 });
  assert.deepEqual(clipped, [{ t: 3.2, v: 1 }, { t: 3.5, v: 0.2 }, { t: 4, v: 0.2 }], 'span past the clip end clips to the range');
  const merged = duckKeysFromSpans(
    [{ start: 0.5, end: 1.2, id: 'a' }, { start: 1.0, end: 1.8, id: 'b' }],
    clip, { on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 });
  assert.ok(!merged.some((k) => k.t > 0.7 && k.t < 1.5 && k.v === 1), 'overlapping spans stay dipped between them');
}

// ---- 4) Keyframe expression -----------------------------------------------------
{
  assert.equal(duckKeysExpr([], 4), 'volume=1', 'no points is unity');
  assert.equal(duckKeysExpr([[0.5, 0.2], [1.5, 0.2]], 4), duckR.duckKeysExpr([[0.5, 0.2], [1.5, 0.2]], 4), 'renderer expr matches');
  const expr = duckKeysExpr([[0.2, 1], [0.5, 0.2], [1.5, 0.2], [1.8, 1]], 4);
  assert.match(expr, /eval=frame/, 'keyframe expression is frame-evaluated');
  // Manual keys win over the derived expression; off / 1x rules apply.
  const clip = { id: 'a1', start: 0, in: 0, out: 4, duck: { on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 },
    duckKeys: [{ t: 0.5, v: 0.5 }, { t: 1.5, v: 0.5 }] };
  const f = standaloneDuckFilters(clip, [{ start: 0.5, end: 1.5, id: 'c1' }], 4);
  assert.equal(f.length, 2, 'manual keys produce the keyframe filter');
  assert.ok(f[1].includes('0.5'), 'manual gain 0.5 is in the expression, not the derived 0.2');
  assert.deepEqual(standaloneDuckFilters({ ...clip, duck: { on: false } }, [], 4), [], 'duck off is no filter');
  assert.deepEqual(standaloneDuckFilters({ ...clip, speed: 2 }, [], 4), [], 'duck does not apply at 2x');
  assert.deepEqual(standaloneDuckFilters({ ...clip, duckKeys: [] }, [], 4), [], 'no spans, no keys: nothing to duck');
}

// ---- 5) Export graphs -----------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb07-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const voice = path.join(dir, 'voice.mp4');
gen(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-ar', '48000', '-ac', '2', voice]);
const music = path.join(dir, 'music.wav');
gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6', '-ar', '48000', '-ac', '2', music]);
const media = [];
for (const [id, p] of [['m1', voice], ['m3', music]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
const mkProject = (duck, duckKeys) => ({
  name: 'duck', ratio: '16:9', resolution: 720, width: 160, height: 90, fps: 30, background: '#000000', media,
  videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0.5, out: 2.5,
    cleanVoice: { on: true, steps: { duck: true } } },
  { id: 'g1', gap: true, in: 0, out: 2.5, speed: 1 }],
  overlayClips: [], textClips: [],
  audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 4, volume: 0.5, fadeIn: 0, fadeOut: 0,
    ...(duck ? { duck } : {}), ...(duckKeys ? { duckKeys } : {}) }],
});
{
  const g = buildExportArgs(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 }), path.join(dir, 'g.mp4')).args.join(' ');
  assert.ok(g.includes("volume='1-0.8*"), `standalone duck uses the configured 0.2 level: ${g.slice(g.indexOf("volume='1-"), g.indexOf("volume='1-") + 60)}`);
  assert.ok(!g.includes("volume='1-0.65*"), 'standalone duck replaces the Clean Voice duck — no double-dip');
  const gOff = buildExportArgs(mkProject(null), path.join(dir, 'g2.mp4')).args.join(' ');
  assert.ok(gOff.includes("volume='1-0.65*"), 'without standalone duck the Clean Voice duck still applies');
  const gKeys = buildExportArgs(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 },
    [{ t: 0.5, v: 0.5 }, { t: 1.5, v: 0.5 }]), path.join(dir, 'g3.mp4')).args.join(' ');
  assert.ok(!gKeys.includes("volume='1-0.8*"), 'manual keys replace the derived expression');
  const gAudio = buildAudioExportArgs(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 }), path.join(dir, 'g.wav'), 'wav').join(' ');
  assert.ok(gAudio.includes("volume='1-0.8*"), 'audio-only export ducks the same way');
}

// ---- 6) Real renders: levels ------------------------------------------------------
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
const musicRatio = (file) => {
  const inSpan = decodeAudio(file, 0.8, 0.5);
  const outSpan = decodeAudio(file, 2.5, 0.9);
  return goertzel(inSpan, 880) / goertzel(outSpan, 880);
};
const duckFile = path.join(dir, 'duck-on.mp4');
await runExport(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 }), duckFile, null).promise;
const rOn = musicRatio(duckFile);
assert.ok(rOn > 0.1 && rOn < 0.32, `standalone duck to 0.2: in/out music ratio ${rOn.toFixed(2)}`);
console.log(`  standalone duck to=0.2: music in/out ratio ${rOn.toFixed(2)}`);
const keysFile = path.join(dir, 'duck-keys.mp4');
await runExport(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 },
  [{ t: 0.2, v: 1 }, { t: 0.5, v: 0.5 }, { t: 1.5, v: 0.5 }, { t: 1.8, v: 1 }]), keysFile, null).promise;
const rKeys = musicRatio(keysFile);
assert.ok(rKeys > 0.35 && rKeys < 0.65, `manual duck keys at 0.5: in/out music ratio ${rKeys.toFixed(2)}`);
console.log(`  manual duck keys at 0.5: music in/out ratio ${rKeys.toFixed(2)}`);

// ---- 7) Cuts: ducking survives a split, and re-derives after a voice cut ---------
{
  // Split the music clip mid-dip (timeline 1.0 s, inside the 0.5–1.5 s voice).
  const split = splitClipAtTimes(mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 },
    [{ t: 0.2, v: 1 }, { t: 0.5, v: 0.2 }, { t: 1.5, v: 0.2 }, { t: 1.8, v: 1 }]),
    'audio', 'a1', [1.0], ['a1b']);
  assert.equal(split.audioClips.length, 2, 'music split into two clips');
  const [left, right] = split.audioClips;
  assert.deepEqual(left.duckKeys, [{ t: 0.2, v: 1 }, { t: 0.5, v: 0.2 }, { t: 1.5, v: 0.2 }, { t: 1.8, v: 1 }],
    'left half keeps the source-time keys');
  assert.deepEqual(right.duckKeys, left.duckKeys, 'right half keeps the same source-time keys');
  assert.equal(right.start, 1.0, 'right half starts at the cut');
  assert.equal(right.in, 1.0, 'right half source starts at the cut');
  const splitFile = path.join(dir, 'duck-split.mp4');
  await runExport(split, splitFile, null).promise;
  const inLeft = goertzel(decodeAudio(splitFile, 0.8, 0.4), 880);
  const inRight = goertzel(decodeAudio(splitFile, 1.2, 0.4), 880);
  const outRef = goertzel(decodeAudio(splitFile, 2.5, 0.9), 880);
  assert.ok(inLeft / outRef > 0.1 && inLeft / outRef < 0.35, `left half still ducked after the split (ratio ${(inLeft / outRef).toFixed(2)})`);
  assert.ok(inRight / outRef > 0.1 && inRight / outRef < 0.35, `right half still ducked after the split (ratio ${(inRight / outRef).toFixed(2)})`);
  console.log(`  after a mid-dip split: left ${(inLeft / outRef).toFixed(2)}, right ${(inRight / outRef).toFixed(2)} (target 0.2)`);
  // Voice cut: shorten the voice clip to end at 1.0 s — the derived ducking
  // must follow, so music at 1.2 s is back to full level.
  const cutVoice = mkProject({ on: true, to: 0.2, fade: 0.3, sensitivity: 0.75 });
  cutVoice.videoClips[0].out = 1.0;
  const cutFile = path.join(dir, 'duck-cutvoice.mp4');
  await runExport(cutVoice, cutFile, null).promise;
  const afterCut = goertzel(decodeAudio(cutFile, 1.3, 0.5), 880);
  const refCut = goertzel(decodeAudio(cutFile, 2.5, 0.9), 880);
  assert.ok(afterCut / refCut > 0.85, `after the voice is cut short, music at 1.3 s is unducked (ratio ${(afterCut / refCut).toFixed(2)})`);
  console.log(`  after cutting the voice short: music at 1.3 s ratio ${(afterCut / refCut).toFixed(2)} (unducked)`);
}
console.log('FB-07 OK: configurable ducking, editable source-time keyframes, no double-dip, survives cuts, re-derives after a voice cut');
