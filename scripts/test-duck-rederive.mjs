// AU-02 — music ducking vs dialogue: spans re-derive after cuts, the depth
// and ramp are editable per voice clip, the preview ducks live, and the
// duck curve bakes into editable volume keyframes.
// Usage: node scripts/test-duck-rederive.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanVoiceDuckSpans, duckVolumeExpr, duckFactorAt, duckSettingsOf } = require('../electron/audiofx.cjs');
const { buildExportArgs } = require('../electron/ffmpeg.cjs');
const store = await import('../src/store.js');
const duckE = await import('../src/duckKeys.js');
const { volumeAt } = await import('../src/volKeys.js');

const DUCK = { on: true, steps: { duck: true } };
const vs = (id) => ({ v1: 0, v2: 4 }[id] ?? 0);

// ---- 1) Spans re-derive after cuts: a split keeps ducking on both halves ----
{
  const project = {
    width: 320, height: 180, fps: 30, background: '#000000',
    media: [{ id: 'm1', type: 'video', path: '/tmp/x.mp4', hasAudio: true }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 8, speed: 1, cleanVoice: DUCK }],
    audioClips: [], overlayClips: [], textClips: [], stickerClips: [], effectClips: [],
  };
  const before = cleanVoiceDuckSpans(project.videoClips, [], vs);
  assert.deepEqual(before.map((s) => [s.start, s.end]), [[0, 8]], 'one span before the cut');
  // A real split through the store reducer.
  const split = store.historyReducer({ past: [], present: project, future: [] },
    { type: 'split', track: 'video', id: 'v1', t: 4, newId: 'v2' }).present;
  assert.equal(split.videoClips.length, 2, 'the split makes two clips');
  assert.ok(split.videoClips.every((c) => c.cleanVoice?.steps?.duck), 'both halves keep the duck step');
  const after = cleanVoiceDuckSpans(split.videoClips, [], (id) => {
    const layout = store.videoLayout(split.videoClips);
    return layout.find((l) => l.clip.id === id)?.start;
  });
  assert.deepEqual(after.map((s) => [s.start, s.end]), [[0, 4], [4, 8]], 'the spans re-derive onto both halves with no gap');
  // Trim + mute + speed follow the same rule.
  const trimmed = { ...project, videoClips: [{ id: 'v1', mediaId: 'm1', in: 2, out: 6, speed: 1, cleanVoice: DUCK }] };
  assert.deepEqual(cleanVoiceDuckSpans(trimmed.videoClips, [], vs).map((s) => [s.start, s.end]), [[0, 4]], 'a trim moves the span');
  const muted = { ...project, videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 8, speed: 1, muted: true, cleanVoice: DUCK }] };
  assert.deepEqual(cleanVoiceDuckSpans(muted.videoClips, [], vs), [], 'a muted voice stops ducking');
  const slow = { ...project, videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 0.5, cleanVoice: DUCK }] };
  assert.deepEqual(cleanVoiceDuckSpans(slow.videoClips, [], vs).map((s) => [s.start, s.end]), [[0, 8]], 'a 0.5x voice speaks twice as long (timeline length, not source length)');
  // The renderer mirror agrees.
  assert.deepEqual(duckE.duckSpansFor(split.videoClips, [], (id) => {
    const layout = store.videoLayout(split.videoClips);
    return layout.find((l) => l.clip.id === id)?.start;
  }).map((s) => [s.start, s.end]), [[0, 4], [4, 8]], 'the renderer mirror re-derives the same spans');
}

// ---- 2) Editable depth/ramp: per-span settings reach the expression ----
{
  assert.deepEqual(duckSettingsOf({}), { duckTo: 0.35, duckRamp: 0.15 }, 'defaults');
  assert.deepEqual(duckSettingsOf({ duckTo: 0.2, duckRamp: 0.5 }), { duckTo: 0.2, duckRamp: 0.5 }, 'stored settings pass through');
  assert.deepEqual(duckSettingsOf({ duckTo: 5, duckRamp: -1 }), { duckTo: 1, duckRamp: 0.02 }, 'settings clamp');
  assert.deepEqual(duckE.duckSettingsOf({ duckTo: 0.2, duckRamp: 0.5 }), { duckTo: 0.2, duckRamp: 0.5 }, 'the renderer mirror agrees on settings');
  // Legacy pinned output is unchanged.
  assert.equal(duckVolumeExpr([[0.5, 2.5]]), "volume='1-0.65*clip((t-0.35)/0.15,0,1)*clip((2.65-t)/0.15,0,1)':eval=frame", 'legacy pairs still render exactly');
  const custom = duckVolumeExpr([{ start: 0.5, end: 2.5, duckTo: 0.2, duckRamp: 0.5 }]);
  assert.ok(custom.includes('1-0.8*') && custom.includes('(t-0)/0.5'), 'a custom depth/ramp renders (depth 0.8, ramp 0.5)');
  assert.equal(duckVolumeExpr([]), null, 'no spans is null');
}

// ---- 3) Preview factor == export curve (sampled at key times) ----
{
  const spans = [{ start: 2, end: 4, id: 'v1', duckTo: 0.35, duckRamp: 0.15 }];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(duckFactorAt(spans, 1), 1), 'before the ramp: full volume');
  assert.ok(near(duckFactorAt(spans, 3), 0.35), 'mid-span: ducked to duckTo');
  assert.ok(near(duckFactorAt(spans, 1.925), 0.675), 'mid-ramp: halfway down');
  assert.ok(near(duckFactorAt(spans, 5), 1), 'after the ramp: full volume again');
  assert.ok(near(duckFactorAt(spans, 3, 'v1'), 1), 'a voiceover never ducks itself');
  assert.ok(near(duckE.duckFactorAt(spans, 3), 0.35), 'the renderer mirror agrees mid-span');
  assert.ok(near(duckE.duckFactorAt(spans, 1.925), 0.675), 'the renderer mirror agrees mid-ramp');
}

// ---- 4) Bake: the duck curve becomes editable volume keyframes ----
{
  const music = { id: 'm1', start: 0, in: 0, out: 10, speed: 1, volume: 1 };
  const spans = [{ start: 2, end: 4, id: 'v1', duckTo: 0.35, duckRamp: 0.15 }];
  const baked = duckE.bakeDuckKeys(music, spans);
  assert.ok(baked, 'baking produces keys');
  assert.equal(volumeAt({ ...music, volKeys: baked.volKeys }, 3), 0.35, 'mid-span the baked keys read duckTo');
  assert.equal(volumeAt({ ...music, volKeys: baked.volKeys }, 0.5), 1, 'outside the span the baked keys read full volume');
  assert.ok(Math.abs(volumeAt({ ...music, volKeys: baked.volKeys }, 1.925) - 0.675) < 0.01, 'mid-ramp the baked keys read halfway');
  assert.equal(duckE.bakeDuckKeys(music, []), null, 'nothing to bake without spans');
  assert.equal(duckE.bakeDuckKeys({ ...music, speed: 2 }, spans), null, 'no bake for non-1x clips (the live expression limit)');
  // Baking multiplies the existing gain curve instead of replacing it.
  const quiet = { ...music, volume: 0.8 };
  const baked2 = duckE.bakeDuckKeys(quiet, spans);
  assert.ok(Math.abs(volumeAt({ ...quiet, volKeys: baked2.volKeys }, 3) - 0.28) < 1e-9, 'a 0.8 clip dips to 0.8 * duckTo');
  assert.equal(volumeAt({ ...quiet, volKeys: baked2.volKeys }, 0.5), 0.8, 'and stays at 0.8 outside');
}

// ---- 5) Export graph: custom depth lands, baked clips skip the live duck ----
{
  // The export needs real media on disk (missing files are rejected).
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { ffmpegPath } = require('../electron/ffmpeg.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-duck-'));
  const vMp4 = path.join(dir, 'v.mp4');
  const mMp3 = path.join(dir, 'm.mp3');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.5', '-shortest',
    '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', vMp4]);
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-c:a', 'libmp3lame', '-b:a', '128k', mMp3]);
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (voiceCv, musicPatch = {}) => ({
    name: 'duck', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#000000',
    media: [
      { id: 'mv', path: vMp4, type: 'video', hasAudio: true },
      { id: 'mm', path: mMp3, type: 'audio', hasAudio: true },
    ],
    videoClips: [{ ...base, id: 'v1', mediaId: 'mv', in: 0, out: 4, cleanVoice: voiceCv }],
    audioClips: [{ ...base, id: 'a1', mediaId: 'mm', start: 0, in: 0, out: 4, ...musicPatch }],
    overlayClips: [], textClips: [], stickerClips: [], effectClips: [],
  });
  const flat = (p) => buildExportArgs(p, path.join(dir, 'out.mp4')).args.join(' ');
  const custom = flat(mkProject({ on: true, steps: { duck: true }, duckTo: 0.2, duckRamp: 0.5 }));
  assert.ok(custom.includes("volume='1-0.8*"), 'the export renders the custom depth (0.8)');
  assert.ok(custom.includes('(t+0.5)/0.5'), 'the export renders the custom ramp (0.5)');
  const baked = flat(mkProject(DUCK, { duckBaked: { voiceId: 'v1', times: [2, 4] } }));
  assert.ok(!baked.includes("volume='1-"), 'a baked music clip skips the live duck expression');
  const plain = flat(mkProject(DUCK));
  assert.ok(plain.includes("volume='1-0.65*"), 'an unbaked clip still gets the live duck expression');
}

// ---- 6) Wiring ----
{
  const preview = fs.readFileSync(new URL('../src/components/Preview.jsx', import.meta.url), 'utf8');
  assert.ok(preview.includes('duckFactorAt(duckSpans, t, c.id)'), 'the preview ducks music live');
  const cv = fs.readFileSync(new URL('../src/components/CleanVoice.jsx', import.meta.url), 'utf8');
  assert.ok(cv.includes("t('cv.duckDepth')") && cv.includes("t('cv.duckRamp')"), 'the Clean Voice panel edits depth and ramp');
  assert.ok(cv.includes('bakeDuckKeys') && cv.includes("t('cv.bakeBtn')") && cv.includes("t('cv.unbake')"), 'the panel bakes and removes baked ducking');
  for (const lang of ['en', 'fr', 'ar']) {
    const dict = fs.readFileSync(new URL(`../src/i18n/${lang}.js`, import.meta.url), 'utf8');
    for (const k of ['"cv.duckDepth"', '"cv.duckRamp"', '"cv.bake"', '"cv.bakeBtn"', '"cv.unbake"', '"cv.bakeNote"', '"cv.bakedNote"']) {
      assert.ok(dict.includes(k), `${lang}: ${k}`);
    }
  }
}

console.log('duck-rederive: all checks passed');
