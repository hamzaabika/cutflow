// Frame-accurate editing engine (P1-04).
//   - frames.js: exact NTSC rationals, quantize idempotent, nearestFrameRate
//     snaps a hand-typed 29.97 to 30000/1001 (never to 30).
//   - store: trimClip / splitAt / trimActions / update quantize timeline
//     geometry to whole frames; source in/out are NOT quantized (they live
//     on the media's own rate, not the project's). Splits share one exact
//     boundary; a split-then-rejoin round-trip drifts by at most half a
//     frame and does not accumulate (an NTSC end like 12.0 s is itself
//     359.64 frames, so no scheme restores it exactly).
//   - sequencePatchFor adopts the probe's exact rate instead of Math.round.
//   - frame steps: ten 1/fps steps land exactly ten frames on, at every rate
//     (the old 1/30 hard-code stepped two frames at 60 fps, 1.25 at 24 fps).
// Usage: node scripts/test-frames.mjs
import assert from 'node:assert/strict';
import { FRAME_RATES, effectiveFps, quantize, toFrame, fromFrame, nearestFrameRate, fpsLabel } from '../src/frames.js';
import { historyReducer, normalizeProject, trimActions, trimClip } from '../src/store.js';
import { sequencePatchFor } from '../src/sequence.js';

const NTSC_24 = 24000 / 1001;
const NTSC_30 = 30000 / 1001;
const NTSC_60 = 60000 / 1001;
const onGrid = (t, fps) => Math.abs(quantize(t, fps) - t) < 1e-9;
// Frame arithmetic is float arithmetic: 60/fps + 10/fps and 70/fps differ
// by one ULP. Exact equality only holds for values copied verbatim (the
// shared split boundary, an untouched in-point); everything computed from
// frame counts compares within a microsecond.
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`);
const run = (st, ...actions) => actions.reduce(historyReducer, st);

// --- frames.js ---------------------------------------------------------------
assert.equal(FRAME_RATES.length, 8, 'eight supported rates');
assert.equal(FRAME_RATES[0].fps, NTSC_24, '23.976 is the exact rational 24000/1001');
assert.equal(FRAME_RATES[3].fps, NTSC_30, '29.97 is the exact rational 30000/1001');
assert.equal(FRAME_RATES[6].fps, NTSC_60, '59.94 is the exact rational 60000/1001');
assert.equal(effectiveFps({}), 30, 'missing fps defaults to 30');
assert.equal(effectiveFps({ fps: 0 }), 30, 'zero fps defaults to 30');
assert.equal(effectiveFps({ fps: NTSC_30 }), NTSC_30, 'NTSC fps passes through');
assert.equal(quantize(0.5, NTSC_30), 15 / NTSC_30, 'quantize: 0.5 s at 29.97 is 15 frames');
assert.ok(onGrid(quantize(1.234567, NTSC_30), NTSC_30), 'quantize lands on the grid');
assert.equal(quantize(quantize(1.234567, NTSC_30), NTSC_30), quantize(1.234567, NTSC_30), 'quantize is idempotent');
assert.equal(toFrame(1, 30), 30, 'toFrame');
assert.equal(fromFrame(30, 30), 1, 'fromFrame');
assert.equal(fromFrame(toFrame(3.333, NTSC_30), NTSC_30), quantize(3.333, NTSC_30), 'toFrame/fromFrame round-trip through the grid');
assert.equal(nearestFrameRate(29.97), NTSC_30, 'nearest: hand-typed 29.97 snaps to 30000/1001, never to 30');
assert.equal(nearestFrameRate(30), 30, 'nearest: 30 stays 30');
assert.equal(nearestFrameRate(23.98), NTSC_24, 'nearest: 23.98 snaps to 24000/1001');
assert.equal(nearestFrameRate(48), null, 'nearest: unsupported 48 snaps to nothing');
assert.equal(nearestFrameRate('junk'), null, 'nearest: non-numeric snaps to nothing');
assert.equal(fpsLabel(NTSC_30), '29.97', 'label: exact rational shows 29.97');
assert.equal(fpsLabel(29.97), '29.97', 'label: hand-typed 29.97 shows 29.97');
assert.equal(fpsLabel(30), '30', 'label: 30 shows 30');
assert.equal(fpsLabel(NTSC_24), '23.976', 'label: 23.976');

// --- normalizeProject fps ----------------------------------------------------
assert.equal(normalizeProject({ fps: 29.97 }).fps, NTSC_30, 'load: stored 29.97 becomes the exact rational');
assert.equal(normalizeProject({ fps: 30 }).fps, 30, 'load: 30 stays 30');
assert.equal(normalizeProject({ fps: 48 }).fps, 48, 'load: an odd rate is kept verbatim');
assert.equal(normalizeProject({}).fps, 30, 'load: missing fps defaults to 30');

// --- trimClip quantizes the delta -------------------------------------------
const fps = NTSC_30;
const base = () => ({
  ...normalizeProject({ fps }),
  magnet: { video: true, overlay: true, audio: true, text: true },
  media: [{ id: 'v', type: 'video', duration: 20, hasAudio: true }],
  videoClips: [{ id: 'v1', mediaId: 'v', in: 2, out: 12, speed: 1, volume: 1, muted: false, transition: null }],
  audioClips: [{ id: 'a1', mediaId: 'v', start: 2, in: 0, out: 5, speed: 1, volume: 1 }],
  // Timeline geometry is frame-exact here (60 and 90 frames at 29.97):
  // 2.0 s flat is NOT on the NTSC grid (59.94 frames), so a test base built
  // on round seconds would fail its own on-grid assertions. Source in/out
  // are deliberately plain seconds — they live on the media's rate.
  textClips: [{ id: 't1', text: 'one', start: 60 / fps, duration: 90 / fps, y: 0.5 }],
});
{
  // Off-grid drag delta (0.3333 s is 9.99 frames at 29.97) trims by exactly
  // 10 frames; the resulting boundary is on the grid.
  const p = trimClip(base(), { track: 'text', id: 't1', edge: 'left', delta: 0.3333 });
  const t1 = p.textClips[0];
  assert.ok(onGrid(t1.start, fps), 'trim: text start lands on a frame');
  assert.ok(onGrid(t1.duration, fps), 'trim: text duration lands on a frame');
  near(t1.start, 70 / fps, 'trim: left trim moved by exactly 10 frames');
  // A main-track left trim inserts a gap clip ahead of the trimmed clip,
  // so find the clip by id — videoClips[0] is the gap, not the clip.
  const q = trimClip(base(), { track: 'video', id: 'v1', edge: 'left', delta: 0.1111 });
  const v1 = q.videoClips.find((c) => c.id === 'v1');
  assert.ok(onGrid(v1.in - 2, fps), 'trim: video source window moves by whole frames');
}

// --- splitAt: shared exact boundary + rejoin round-trip ----------------------
{
  const st0 = { past: [], present: base(), future: [] };
  const cut = 3.333; // off-grid at 29.97: 99.89 frames
  const st1 = run(st0, { type: 'split', track: 'video', id: 'v1', t: cut, newId: 'v2' });
  const [left, right] = st1.present.videoClips;
  assert.equal(st1.present.videoClips.length, 2, 'split: one clip becomes two');
  assert.equal(left.out, right.in, 'split: halves share one exact boundary');
  assert.ok(onGrid(left.out - 2, fps), 'split: cut lands on a frame');
  near(left.out - left.in + (right.out - right.in), 10, 'split: total length preserved');
  assert.equal(right.id, 'v2', 'split: new half takes the new id');
  // Splitting either half at the shared boundary again is a no-op. NOTE:
  // split takes a TIMELINE time — the shared boundary in timeline seconds
  // is the left half's length (it starts at 0), not its source out-point.
  const boundary = left.out - left.in;
  const st2 = run(st1, { type: 'split', track: 'video', id: 'v2', t: boundary, newId: 'v3' });
  assert.equal(st2.present.videoClips.length, 2, 'split: re-splitting at the shared boundary is a no-op');
  // Rejoin: delete the right half, extend the left half back to the end.
  // At NTSC rates the original end (12.0 s = 359.64 frames) is itself off
  // the grid, so no quantization restores it exactly — the guarantee is
  // bounded drift (half a frame: the delta is quantized, the error is the
  // rounding of one delta) and no accumulation across cycles.
  const st3 = run(st1, { type: 'delete', track: 'video', id: 'v2' });
  const rejoined = trimClip(st3.present, { track: 'video', id: 'v1', edge: 'right', delta: -(12 - left.out) });
  assert.equal(rejoined.videoClips.length, 1, 'rejoin: one clip again');
  assert.ok(Math.abs(rejoined.videoClips[0].out - 12) <= 1 / (2 * fps) + 1e-9, 'rejoin: drift bounded by half a frame');
  assert.equal(rejoined.videoClips[0].in, 2, 'rejoin: the original in-point is untouched');
  // No accumulation: split the rejoined clip at the same time — same boundary.
  const st4 = run({ past: [], present: rejoined, future: [] }, { type: 'split', track: 'video', id: 'v1', t: cut, newId: 'v4' });
  assert.ok(Math.abs(st4.present.videoClips[0].out - left.out) < 1e-9, 'rejoin: a second split lands on the same boundary');
}

// --- update: timeline geometry quantized, source times untouched -------------
{
  const st0 = { past: [], present: base(), future: [] };
  const st1 = run(st0, { type: 'update', track: 'text', id: 't1', patch: { start: 2.3333, duration: 1.7777 } });
  const t1 = st1.present.textClips[0];
  assert.ok(onGrid(t1.start, fps), 'update: start quantized to a frame');
  assert.ok(onGrid(t1.duration, fps), 'update: duration quantized to a frame');
  const st2 = run(st0, { type: 'update', track: 'audio', id: 'a1', patch: { in: 1.234, out: 4.567 } });
  const a1 = st2.present.audioClips[0];
  assert.equal(a1.in, 1.234, 'update: source in-point is NOT quantized (media rate, not project rate)');
  assert.equal(a1.out, 4.567, 'update: source out-point is NOT quantized');
}

// --- trimActions quantizes the cut -------------------------------------------
{
  const actions = trimActions(base(), { track: 'video', id: 'v1', t: 3.333, side: 'left', newId: 'v9' });
  assert.equal(actions.length, 2, 'trimActions: split + delete');
  assert.equal(actions[0].t, quantize(3.333, fps), 'trimActions: cut time is the quantized time');
  assert.ok(onGrid(actions[0].t, fps), 'trimActions: cut time is on the grid');
}

// --- sequencePatchFor adopts the probe's exact rate ---------------------------
{
  const patch = sequencePatchFor({ type: 'video', width: 1920, height: 1080, fps: 30, fpsExact: NTSC_30 });
  assert.equal(patch.fps, NTSC_30, 'sequence: a 29.97 clip adopts 30000/1001, not Math.round 30');
  const patch25 = sequencePatchFor({ type: 'video', width: 1280, height: 720, fps: 25 });
  assert.equal(patch25.fps, 25, 'sequence: a 25 fps clip without fpsExact adopts 25');
}

// --- frame steps: ten 1/fps steps are exactly ten frames, at every rate -----
for (const r of FRAME_RATES) {
  let t = 0;
  for (let i = 0; i < 10; i++) t = quantize(t + 1 / r.fps, r.fps);
  assert.equal(toFrame(t, r.fps), 10, `frame step: ten steps at ${r.label} fps are exactly ten frames`);
  // The old hard-code: ten 1/30 steps at 60 fps are twenty frames, not ten.
  if (r.fps === 60) {
    let bad = 0;
    for (let i = 0; i < 10; i++) bad = quantize(bad + 1 / 30, 60);
    assert.equal(toFrame(bad, 60), 20, 'frame step: the old 1/30 step really was two frames at 60 fps (why the fix matters)');
  }
}

console.log('FRAMES OK');
