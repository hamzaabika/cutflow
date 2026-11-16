// Gap-build stream A (§5.1) checks. Usage: node scripts/test-gap-a.mjs
// One file per stream so the coordinator can run each stream's proof alone.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cutRanges, moveRanges, normalizeCutRanges, normalizeProject, videoLayout, projectDuration } from '../src/store.js';
import { AUDIO_PRESETS, mergeAudioFxLayer } from '../src/fx/audioPresets.js';
import { correctCaptionClips, correctCaptionText } from '../src/captionCorrection.js';
import { resolveDecodeMode } from '../electron/hwdecode.cjs';

const require = createRequire(import.meta.url);
const { audioFxFilters } = require('../electron/audiofx.cjs');
const { fpsOf } = require('../electron/matting.cjs');
const { probe } = require('../electron/ffmpeg.cjs');
const { audioFxFilters: rendererFxFilters } = await import('../src/fx/audioFxChain.js').catch(() => ({ audioFxFilters: null }));

const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const layout = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${+l.start.toFixed(2)}-${+l.end.toFixed(2)}[${+l.clip.in.toFixed(2)}..${+l.clip.out.toFixed(2)}]`).join(' ');
const base = () => ({ ...normalizeProject({}), media: [{ id: 'm', type: 'video', duration: 30 }], videoClips: [mk('a', 10)] });

// ---- A-F1: overlapping cut ranges count their union once, never the sum ----
// Canonical helper is master's normalizeCutRanges (CC FB-02, P1-01); gap-a's
// mergeRanges/removedBefore were folded into it at merge time. removedBefore
// here is a local view over the normalized ranges, not a second helper.
const mergeRanges = (rs) => normalizeCutRanges(rs, Infinity);
const removedBefore = (rs, t) => normalizeCutRanges(rs, Infinity)
  .reduce((n, r) => n + (t > r.start ? Math.max(0, Math.min(r.end, t) - r.start) : 0), 0);
assert.deepEqual(mergeRanges([{ start: 2, end: 5 }, { start: 4, end: 7 }]), [{ start: 2, end: 7 }]);
assert.deepEqual(mergeRanges([{ start: 8, end: 10 }, { start: 0, end: 1 }, { start: 4, end: 5 }]), [{ start: 0, end: 1 }, { start: 4, end: 5 }, { start: 8, end: 10 }]);
assert.deepEqual(mergeRanges([{ start: 1, end: 3 }, { start: 3, end: 4 }]), [{ start: 1, end: 4 }], 'touching ranges merge');
assert.equal(removedBefore([{ start: 2, end: 5 }, { start: 4, end: 7 }], 10), 5, 'overlap counted once');
assert.equal(removedBefore([{ start: 2, end: 5 }, { start: 4, end: 7 }], 6), 4, 'partial overlap before t');
assert.equal(removedBefore([{ start: 2, end: 5 }, { start: 4, end: 7 }], 3), 1);

// Overlapping cuts remove 5 s total (2..7), not 6: the survivor is 5 s long.
let p = cutRanges(base(), [{ start: 2, end: 5 }, { start: 4, end: 7 }]);
assert.equal(layout(p), 'a@0-2[0..2] a-c1@2-5[7..10]');
assert.equal(projectDuration(p), 5);

// Ripple text follows the same union: the caption after the cuts lands at 2, not 1.
p = cutRanges({ ...base(), textClips: [{ id: 't1', start: 0, duration: 10, text: 'hello world' }] }, [{ start: 2, end: 5 }, { start: 4, end: 7 }], { rippleText: true });
assert.equal(p.textClips.length, 2);
assert.equal(p.textClips[1].start, 2);
assert.equal(p.textClips[1].duration, 3);

// moveRanges with overlapping ranges moves the union once: total duration unchanged.
p = moveRanges(base(), [{ start: 2, end: 5 }, { start: 4, end: 7 }], 0);
assert.equal(projectDuration(p), 10);
assert.equal(layout(p).split(' ')[0], 'a-m0@0-5[2..7]');

// ---- B-F03: a 900 Hz lowpass is a real filter in both chain copies ----
assert.ok(audioFxFilters({ lowpass: 900 }).includes('lowpass=f=900'), 'engine emits lowpass 900');
assert.ok(audioFxFilters({ lowpass: 900 }).length >= 1);
assert.deepEqual(audioFxFilters({ lowpass: 0 }), [], 'lowpass 0 stays off');
assert.deepEqual(audioFxFilters({ lowpass: 20000 }), [], 'lowpass at Nyquist stays off');
const under = AUDIO_PRESETS.find((x) => x.id === 'underwater');
assert.ok(under && under.fx.lowpass === 900, 'Underwater preset still 900 Hz');
assert.ok(audioFxFilters(under.fx).some((f) => f.startsWith('lowpass=f=900')), 'Underwater now drives its lowpass');
if (rendererFxFilters) {
  assert.deepEqual(rendererFxFilters({ lowpass: 900 }), audioFxFilters({ lowpass: 900 }), 'renderer chain mirrors engine at 900 Hz');
}

// ---- B-F17: audio presets can merge as a layer instead of replacing ----
const current = { eq: { low: 2, mid: 0, high: 0 }, highpass: 0, lowpass: 0, comp: false, denoise: false, loudnorm: false, echo: null, pitch: 0 };
const merged = mergeAudioFxLayer(current, under.fx);
assert.equal(merged.eq.low, 4, 'preset EQ lands');
assert.equal(merged.lowpass, 900, 'preset lowpass lands');
assert.equal(merged.pitch, -1, 'preset pitch lands');
assert.equal(merged.denoise, false, 'preset off-switch does not clear an untouched field');
// A preset field left at its default leaves the current value alone.
const withHp = mergeAudioFxLayer({ ...current, highpass: 120 }, under.fx);
assert.equal(withHp.highpass, 120, 'preset highpass 0 (off) keeps the current highpass');
// Merging is a pure function: neither input is mutated.
assert.equal(current.eq.low, 2);
assert.equal(under.fx.lowpass, 900);

// ---- B-H-capcor: deterministic caption correction ----
assert.equal(correctCaptionText('hello  world'), 'Hello world');
assert.equal(correctCaptionText('this is is a test'), 'This is a test');
assert.equal(correctCaptionText('hello , world .'), 'Hello, world.');
assert.equal(correctCaptionText('hello world'), 'Hello world');
assert.equal(correctCaptionText('HELLO WORLD'), 'HELLO WORLD', 'all-caps shouting is left alone');
assert.equal(correctCaptionText('salam 3likom'), 'Salam 3likom', 'darija words are kept, only cased');
assert.equal(correctCaptionText('  spaced   out  '), 'Spaced out');
assert.equal(correctCaptionText('it costs 3.5 dollars'), 'It costs 3.5 dollars', 'decimals are never split');
assert.equal(correctCaptionText(''), '');
const { clips, changes } = correctCaptionClips([
  { id: 'c1', start: 0, duration: 2, text: 'hello  world', caption: true, words: [{ text: 'hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }] },
  { id: 'c2', start: 2, duration: 2, text: 'already fine.', caption: true },
  { id: 'c3', start: 4, duration: 2, text: 'not a caption', caption: false },
]);
assert.equal(clips[0].text, 'Hello world');
assert.equal(changes.length, 2);
assert.deepEqual(changes[0], { id: 'c1', before: 'hello  world', after: 'Hello world' });
assert.deepEqual(changes[1], { id: 'c2', before: 'already fine.', after: 'Already fine.' });
assert.deepEqual(clips[0].words.map((w) => w.text), ['Hello', 'world'], 'word timings survive re-casing');
assert.equal(clips[1].text, 'Already fine.');
assert.equal(clips[2].text, 'not a caption', 'non-caption text clips are untouched');
// A dropped duplicate drops only that word's timing.
const dup = correctCaptionClips([{ id: 'd1', caption: true, text: 'the the cat', words: [{ text: 'the', start: 0, end: 0.3 }, { text: 'the', start: 0.3, end: 0.6 }, { text: 'cat', start: 0.6, end: 1 }] }]);
assert.equal(dup.clips[0].text, 'The cat');
assert.deepEqual(dup.clips[0].words.map((w) => [w.text, w.start]), [['The', 0], ['cat', 0.6]]);

// ---- A-F4 / P1-22: GPU video-decode decision is a pure, denylisted probe ----
// Canonical implementation is master's hwdecode.cjs resolveDecodeMode (CC
// FB-17); gap-a's decideGpuVideo was folded into it at merge time. Auto
// needs a usable accelerator from `ffmpeg -hwaccels`, so the hardware cases
// pass one explicitly.
const deny = resolveDecodeMode({ gpuInfo: { gpuDevice: [{ active: true, vendorId: 0x8086, deviceId: 0x191b, deviceName: 'Intel(R) HD Graphics 530' }] } });
assert.equal(deny.mode, 'cpu', 'HD 530 stays on CPU decode');
assert.ok(deny.deniedBy, 'denylist reason reported');
const ok = resolveDecodeMode({ gpuInfo: { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c82, deviceName: 'NVIDIA GeForce GTX 1050 Ti' }] }, hwaccels: ['cuda'] });
assert.equal(ok.mode, 'hardware');
const noAccel = resolveDecodeMode({ gpuInfo: { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c82, deviceName: 'NVIDIA GeForce GTX 1050 Ti' }] }, hwaccels: [] });
assert.equal(noAccel.mode, 'cpu', 'auto without an accelerator stays on CPU decode');
const sw = resolveDecodeMode({ gpuInfo: { gpuDevice: [{ active: true, vendorId: 0, deviceId: 0, deviceName: '' }], auxAttributes: { gl_renderer: 'llvmpipe' } } });
assert.equal(sw.mode, 'cpu', 'software renderer stays on CPU decode');
assert.equal(resolveDecodeMode({ gpuInfo: null }).mode, 'cpu', 'no GPU info stays on CPU decode');
assert.equal(resolveDecodeMode({ env: { FVE_GPU_VIDEO: '1' }, gpuInfo: { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c82 }] }, hwaccels: ['cuda'] }).mode, 'hardware', 'FVE_GPU_VIDEO=1 forces on');
assert.equal(resolveDecodeMode({ env: { FVE_GPU_VIDEO: '0' }, gpuInfo: { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c82 }] } }).mode, 'cpu', 'FVE_GPU_VIDEO=0 forces off');

// ---- A-F5: edit ops use the exact source rate, not the rounded UI fps ----
assert.equal(fpsOf({ fps: 30, fpsExact: 30000 / 1001 }), 29.97, 'NTSC matte rate is exact, not rounded to 30');
assert.equal(fpsOf({ fps: 30 }), 30, 'rounded fps is only the fallback');
assert.equal(fpsOf({}), 30, 'missing rate falls back to 30');
// The probe itself: generate a real 29.97 clip and check fps 30 sits
// beside the exact rational (no binary fixture in the repo).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-a-ntsc-'));
const ntscFile = path.join(tmp, 'ntsc.mp4');
execFileSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30000/1001', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ntscFile]);
const ntsc = await probe(ntscFile);
assert.equal(ntsc.fps, 30);
assert.ok(Math.abs(ntsc.fpsExact - 30000 / 1001) < 0.001, `fpsExact ${ntsc.fpsExact}`);
assert.equal(ntsc.fpsRational, '30000/1001');
fs.rmSync(tmp, { recursive: true, force: true });

// ---- B-F07: batched read/write renders byte-identically to per-frame ----
const { FxJobs } = require('../electron/fxjobs.cjs');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const batchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-a-fxbatch-'));
const batchSrc = path.join(batchDir, 'a.mp4');
execFileSync(require('ffmpeg-static'), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xE63946:size=320x240:rate=30:duration=3.4', '-pix_fmt', 'yuv420p', batchSrc]);
const batchMedia = { id: 'm-a', path: batchSrc, name: 'a.mp4', ...(await probe(batchSrc)) };
const batchProject = {
  name: 'batch-test', ratio: '4:3', width: 320, height: 240, fps: 30, background: '#000000',
  media: [batchMedia],
  videoClips: [{ id: 'c1', mediaId: 'm-a', in: 0, out: 1, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00', mask: null, maskFeather: 0, crop: null, transform: null }],
  overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
  effectClips: [{ id: 'e1', type: 'vignette', track: 'video', in: 0, out: 1, settings: { strength: 0.5 } }],
};
const batchPaint = (frame) => { const out = Buffer.from(frame); for (let i = 0; i < out.length; i += 4) out[i + 1] = Math.min(255, out[i + 1] + 40); return out; };
async function renderJob(jobs, useBatch) {
  const job = await jobs.begin(batchProject, { kind: 'clip', track: 'video', clipId: 'c1' });
  let frames = 0, calls = 0;
  if (!job.cached) {
    if (useBatch) {
      for (let base = 0; base < job.frames; base += 4) {
        const got = await jobs.readMany(job.id, Math.min(4, job.frames - base)); calls++;
        if (!got.length) break;
        await jobs.writeMany(job.id, got.map(batchPaint)); calls++;
        frames += got.length;
      }
    } else {
      for (let k = 0; k < job.frames; k++) { const got = await jobs.read(job.id); calls++; if (!got) break; await jobs.write(job.id, batchPaint(got)); calls++; frames++; }
    }
  }
  const end = await jobs.end(job.id);
  return { end, file: jobs.jobs.get(job.id).file, frames, calls };
}
const jobsSingle = new FxJobs(() => path.join(batchDir, 'cache1'));
const single = await renderJob(jobsSingle, false);
const jobsBatch = new FxJobs(() => path.join(batchDir, 'cache2'));
const batched = await renderJob(jobsBatch, true);
assert.equal(batched.frames, single.frames, 'batched renders the same frame count');
assert.equal(batched.frames, 30);
assert.equal(batched.end.frames, single.end.frames);
// Two separate encodes carry different container metadata, so the files
// differ while the pictures must not: compare decoded frames.
const decodeRaw = (file) => { const out = path.join(path.dirname(file), `dec-${path.basename(file)}.raw`); execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', out]); return fs.readFileSync(out); };
assert.ok(decodeRaw(batched.file).equals(decodeRaw(single.file)), 'batched segment decodes frame-identically to the per-frame render');
assert.ok(batched.calls < single.calls, `batched uses fewer round trips (${batched.calls} vs ${single.calls} for ${single.frames} frames)`);
jobsSingle.clear(); jobsBatch.clear();
fs.rmSync(batchDir, { recursive: true, force: true });

// ---- B-F08: onTime publishes only when the frame index moves ----
import { isNewFrame } from '../src/frames.js';
assert.equal(isNewFrame(null, 0, 30), true, 'first publish');
assert.equal(isNewFrame(0, 1 / 60, 30), false, 'same 30 fps frame as the previous display tick');
assert.equal(isNewFrame(0, 1 / 30, 30), true, 'next frame publishes');
assert.equal(isNewFrame(0.5, 0.2, 30), true, 'a backwards seek always publishes');
assert.equal(isNewFrame(1.0, 1.0 + 1 / 60, 60), true, 'a 60 fps project still publishes every display tick');
// A 60 Hz rAF loop over 1 s of 30 fps footage: 60 ticks -> 30 publishes.
let pubs = 0, prevT = null;
for (let i = 0; i < 60; i++) { const t = i / 60; if (isNewFrame(prevT, t, 30)) { pubs++; prevT = t; } }
assert.equal(pubs, 30, 'display-rate ticks collapse to frame-rate publishes');

// ---- A-15: perf trace sampling from a fake video element ----
import { createPerfTrace, samplePlaybackQuality, noteSeek, perfTraceSummary } from '../src/perfTrace.js';
const trace = createPerfTrace();
assert.equal(trace.enabled, false, 'tracing is off by default');
const fakeEl = { getVideoPlaybackQuality: () => ({ totalVideoFrames: 120, droppedVideoFrames: 3, corruptedVideoFrames: 0 }) };
samplePlaybackQuality(trace, fakeEl);
assert.equal(trace.total, 120);
assert.equal(trace.dropped, 3);
assert.equal(trace.samples.length, 1);
samplePlaybackQuality(trace, null); // a missing element is a no-op, not a crash
assert.equal(trace.samples.length, 1);
noteSeek(trace, 42.4); noteSeek(trace, 18.1);
assert.equal(perfTraceSummary(trace).droppedPct, 2.5);
assert.equal(perfTraceSummary(trace).seekMedianMs, 42.4);

console.log('GAP-A OK');
