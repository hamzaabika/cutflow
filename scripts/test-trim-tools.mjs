// Roll / slip / slide / rate-stretch (P2-01, TL-05).
// Usage: node scripts/test-trim-tools.mjs
import { emptyProject, historyReducer, videoLayout, clipLen } from '../src/store.js';
import { rollEdit, slipClip, slideClip, rateStretch } from '../src/trimTools.js';

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const near = (a, b, what) => assert(Math.abs(a - b) < 1e-6, `${what}: got ${a}, expected ${b}`);
const state = (project) => ({ past: [], present: project, future: [] });
const clip = (id, over = {}) => ({ id, mediaId: 'm0', in: 0, out: 10, speed: 1, volume: 1, muted: false, ...over });
const base = (videoClips, over = {}) => ({
  ...emptyProject(),
  media: [
    { id: 'm0', type: 'video', duration: 40, width: 1280, height: 720, hasAudio: true },
    { id: 'm1', type: 'video', duration: 40, width: 1280, height: 720, hasAudio: true },
    { id: 'a0', type: 'audio', duration: 40, hasAudio: true },
  ],
  videoClips,
  ...over,
});
const lay = (p) => videoLayout(p.videoClips).map((l) => [l.clip.id, Math.round(l.start * 100) / 100, Math.round(l.end * 100) / 100, l.clip.in, l.clip.out]);

// --- Roll: total duration unchanged, edit point moves, sync preserved.
{
  const p = base([clip('v1', { mediaId: 'm0', in: 0, out: 10 }), clip('v2', { mediaId: 'm1', in: 5, out: 15 })]);
  const r = rollEdit(p, { track: 'video', id: 'v2', edge: 'left', delta: 2 });
  assert(r !== p, 'roll applies');
  near(videoLayout(r.videoClips).reduce((n, l) => l.end, 0), 20, 'roll keeps total duration');
  near(r.videoClips[0].out, 12, 'roll: A out grows');
  near(r.videoClips[1].in, 7, 'roll: B in advances');
  near(r.videoClips[1].out, 15, 'roll: B out fixed');
  // Roll the other way past B's head: clamped by B.in >= 0.
  const r2 = rollEdit(p, { track: 'video', id: 'v2', edge: 'left', delta: -8 });
  near(r2.videoClips[1].in, 0, 'roll clamps at source start');
  near(r2.videoClips[0].out, 5, 'roll clamps A with B');
  // Roll past A's tail (media ends at 40, A.out 10 + 30 max) and past B's MIN_CLIP.
  const r3 = rollEdit(p, { track: 'video', id: 'v1', edge: 'right', delta: 9.95 });
  near(r3.videoClips[1].in, 14.9, 'roll clamps at B MIN_CLIP');
  // No neighbour / gap neighbour: no-op.
  assert(rollEdit(p, { track: 'video', id: 'v1', edge: 'left', delta: 1 }) === p, 'roll with no left neighbour is a no-op');
  const pg = base([clip('v1'), { id: 'g1', gap: true, in: 0, out: 2, speed: 1 }, clip('v2', { mediaId: 'm1', in: 0, out: 5 })]);
  assert(rollEdit(pg, { track: 'video', id: 'v2', edge: 'left', delta: 1 }) === pg, 'roll against a gap is a no-op');
}

// --- Slip: start and length fixed, window moves inside the media.
{
  const p = base([clip('v1', { in: 10, out: 20 })]);
  const s = slipClip(p, { track: 'video', id: 'v1', delta: 3 });
  near(s.videoClips[0].in, 13, 'slip: in moves');
  near(s.videoClips[0].out, 23, 'slip: out moves with it');
  near(videoLayout(s.videoClips)[0].start, 0, 'slip: start fixed');
  near(clipLen(s.videoClips[0]), 10, 'slip: length fixed');
  const s2 = slipClip(p, { track: 'video', id: 'v1', delta: -15 });
  near(s2.videoClips[0].in, 0, 'slip clamps at media start');
  const s3 = slipClip(p, { track: 'video', id: 'v1', delta: 25 });
  near(s3.videoClips[0].out, 40, 'slip clamps at media end');
}

// --- Slide: clip moves, neighbours absorb it, total duration fixed.
{
  const p = base([
    clip('v1', { mediaId: 'm0', in: 0, out: 10 }),
    clip('v2', { mediaId: 'm1', in: 0, out: 10 }),
    clip('v3', { mediaId: 'm0', in: 20, out: 30 }),
  ]);
  const s = slideClip(p, { track: 'video', id: 'v2', delta: 2 });
  assert(s !== p, 'slide applies');
  near(videoLayout(s.videoClips).reduce((n, l) => l.end, 0), 30, 'slide keeps total duration');
  near(s.videoClips[0].out, 12, 'slide: prev extends');
  near(s.videoClips[1].in, 0, 'slide: moved clip window unchanged');
  near(s.videoClips[1].out, 10, 'slide: moved clip window unchanged (out)');
  near(s.videoClips[2].in, 22, 'slide: next trims its head');
  near(videoLayout(s.videoClips)[1].start, 12, 'slide: moved clip starts later');
  // Slide left: prev trims, next extends.
  const s2 = slideClip(p, { track: 'video', id: 'v2', delta: -3 });
  near(s2.videoClips[0].out, 7, 'slide left: prev trims');
  near(s2.videoClips[2].in, 17, 'slide left: next extends into the gap');
  near(videoLayout(s2.videoClips)[1].start, 7, 'slide left: moved clip starts earlier');
  // Slide clamped by the next clip running out of headroom.
  const s3 = slideClip(p, { track: 'video', id: 'v2', delta: 9.95 });
  near(s3.videoClips[2].in, 29.9, 'slide clamps at next MIN_CLIP');
  // No neighbours: no-op.
  const solo = base([clip('v1')]);
  assert(slideClip(solo, { track: 'video', id: 'v1', delta: 1 }) === solo, 'single-clip slide is a no-op');
}

// --- Rate-stretch: window fixed, speed follows the new length; pitch mode explicit.
{
  const p = base([clip('v1', { in: 0, out: 10, speed: 1 })]);
  const r = rateStretch(p, { track: 'video', id: 'v1', delta: 10 });
  near(r.videoClips[0].speed, 0.5, 'rate-stretch: doubling length halves speed');
  near(r.videoClips[0].out, 10, 'rate-stretch: source window unchanged');
  near(clipLen(r.videoClips[0]), 20, 'rate-stretch: timeline length follows speed');
  assert(r.videoClips[0].ratePitch === 'preserve', 'rate-stretch defaults to pitch preserve');
  const r2 = rateStretch(p, { track: 'video', id: 'v1', delta: -5, preservePitch: false });
  near(r2.videoClips[0].speed, 2, 'rate-stretch: halving length doubles speed');
  assert(r2.videoClips[0].ratePitch === 'shift', 'rate-stretch records pitch-shift mode');
  // Speed clamp: 0.25x floor.
  const r3 = rateStretch(p, { track: 'video', id: 'v1', delta: 100 });
  near(r3.videoClips[0].speed, 0.25, 'rate-stretch clamps speed at 0.25x');
  near(clipLen(r3.videoClips[0]), 40, 'rate-stretch length follows the clamped speed');
  // Speed clamp: 4x ceiling.
  const r4 = rateStretch(p, { track: 'video', id: 'v1', delta: -9 });
  near(r4.videoClips[0].speed, 4, 'rate-stretch clamps speed at 4x');
}

// --- Free-track roll/slip/slide/rate on the audio lane.
{
  const p = base([clip('v1', { in: 0, out: 10 })], {
    audioClips: [
      { id: 'a1', mediaId: 'a0', start: 0, in: 0, out: 10, speed: 1, volume: 1 },
      { id: 'a2', mediaId: 'a0', start: 10, in: 10, out: 20, speed: 1, volume: 1 },
    ],
  });
  const r = rollEdit(p, { track: 'audio', id: 'a2', edge: 'left', delta: 2 });
  near(r.audioClips[0].out, 12, 'audio roll: A out grows');
  near(r.audioClips[1].in, 12, 'audio roll: B in advances');
  near(r.audioClips[1].start, 12, 'audio roll: B start shifts');
  const s = slipClip(p, { track: 'audio', id: 'a1', delta: 2 });
  near(s.audioClips[0].in, 2, 'audio slip moves the window');
  near(s.audioClips[0].start, 0, 'audio slip keeps start');
  const sl = slideClip(p, { track: 'audio', id: 'a1', delta: 2 });
  near(sl.audioClips[0].start, 2, 'audio slide moves the clip');
  near(sl.audioClips[1].in, 12, 'audio slide trims the neighbour head');
  near(sl.audioClips[1].start, 12, 'audio slide neighbour starts later');
  const rt = rateStretch(p, { track: 'audio', id: 'a1', delta: 10 });
  near(rt.audioClips[0].speed, 0.5, 'audio rate-stretch halves speed');
}

// --- Reducer wiring: actions, undo, lock guard.
{
  let s = state(base([clip('v1', { in: 0, out: 10 }), clip('v2', { mediaId: 'm1', in: 5, out: 15 }), clip('v3', { mediaId: 'm0', in: 20, out: 30 })]));
  s = historyReducer(s, { type: 'rollEdit', track: 'video', id: 'v2', edge: 'left', delta: 2 });
  near(s.present.videoClips[0].out, 12, 'reducer rollEdit');
  s = historyReducer(s, { type: 'undo' });
  near(s.present.videoClips[0].out, 10, 'rollEdit undoes');
  s = historyReducer(s, { type: 'slipClip', track: 'video', id: 'v1', delta: 2 });
  near(s.present.videoClips[0].in, 2, 'reducer slipClip');
  s = historyReducer(s, { type: 'slideClip', track: 'video', id: 'v2', delta: 1 });
  near(s.present.videoClips[0].out, 13, 'reducer slideClip extends the prev clip');
  near(s.present.videoClips[2].in, 21, 'reducer slideClip trims the next clip');
  s = historyReducer(s, { type: 'rateStretch', track: 'video', id: 'v1', delta: 10, preservePitch: false });
  // v1's span is 11 after the slide extended it (in 2, out 13): 11 / (11 + 10).
  near(s.present.videoClips[0].speed, 11 / 21, 'reducer rateStretch');
  assert(s.present.videoClips[0].ratePitch === 'shift', 'reducer rateStretch pitch mode');
  // Locked main track refuses all four.
  const locked = { ...s.present, layerState: { 'video:0': { locked: true } } };
  let ls = state(locked);
  for (const a of [
    { type: 'rollEdit', track: 'video', id: 'v2', edge: 'left', delta: 1 },
    { type: 'slipClip', track: 'video', id: 'v1', delta: 1 },
    { type: 'slideClip', track: 'video', id: 'v1', delta: 1 },
    { type: 'rateStretch', track: 'video', id: 'v1', delta: 1 },
  ]) {
    const before = ls.present;
    ls = historyReducer(ls, a);
    assert(ls.present === before, `locked layer refuses ${a.type}`);
  }
}

console.log('test-trim-tools: all checks passed');
