// Beat grid: manual BPM/offset grid, snapping, tap tempo (P2-22, AU-08).
// Usage: node scripts/test-beat-grid.mjs
import { emptyProject, historyReducer, projectDuration } from '../src/store.js';
import { beatGrid, clampBpm, snapToBeat, tapTempo, isManualBeatGrid } from '../src/beats.js';

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const eq = (a, b, what) => assert(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
const near = (a, b, what) => assert(Math.abs(a - b) < 1e-9, `${what}: got ${a}, expected ${b}`);
const state = (project) => ({ past: [], present: project, future: [] });
const clip = (id, over = {}) => ({ id, mediaId: 'm0', in: 0, out: 10, speed: 1, volume: 1, muted: false, ...over });
const base = () => ({
  ...emptyProject(),
  media: [{ id: 'm0', type: 'video', duration: 40, width: 1280, height: 720, hasAudio: true }],
  videoClips: [clip('v1', { in: 0, out: 10 }), clip('v2', { in: 10, out: 20 }), clip('v3', { in: 20, out: 30 })],
});

// --- Grid generation.
{
  eq(beatGrid(120, 0, 0, 2), [0, 0.5, 1, 1.5, 2], '120 BPM grid at 0.5 s steps');
  eq(beatGrid(60, 0.25, 0, 2), [0.25, 1.25], 'offset shifts the whole grid');
  eq(beatGrid(120, -0.5, 0, 1), [0, 0.5, 1], 'negative offset: first beat lands at 0');
  eq(beatGrid(120, 0, 1.2, 2.2), [1.5, 2], 'grid over a sub-range');
  eq(beatGrid(10, 0, 0, 10), beatGrid(40, 0, 0, 10), 'BPM clamps to the 40 floor');
  eq(beatGrid(999, 0, 0, 1), beatGrid(240, 0, 0, 1), 'BPM clamps to the 240 ceiling');
  near(clampBpm(0), 40, 'clampBpm floor');
  near(clampBpm(300), 240, 'clampBpm ceiling');
  eq(beatGrid(120, 0, 5, 2), [], 'empty range is an empty grid');
}

// --- Snapping.
{
  const times = [0, 0.5, 1, 1.5, 2];
  near(snapToBeat(0.52, times), 0.5, 'snap pulls to the nearest beat');
  near(snapToBeat(0.7, times), 0.7, 'outside tolerance the time is untouched');
  near(snapToBeat(1.4, times, 0.05), 1.4, 'a tight tolerance does not snap');
  near(snapToBeat(0.5, []), 0.5, 'no grid, no snap');
}

// --- Tap tempo.
{
  assert(tapTempo([]) === null, 'tap needs two taps');
  assert(tapTempo([0]) === null, 'one tap is not a tempo');
  near(tapTempo([0, 0.5, 1.0, 1.5]), 120, 'steady taps at 120 BPM');
  near(tapTempo([0, 0.5, 1.0, 1.6, 2.0]), 120, 'one stray tap does not move the median');
  assert(tapTempo([0, 0.02, 0.04]) === null, 'absurdly fast taps are rejected');
  assert(tapTempo([0, 5, 10]) === null, 'absurdly slow taps are rejected');
}

// --- Store: manual grid, offset nudge, provenance, undo.
{
  let s = state(base());
  near(projectDuration(s.present), 30, 'fixture lasts 30 s');
  s = historyReducer(s, { type: 'setBeatGrid', bpm: 120, offset: 0 });
  const b = s.present.beats;
  assert(b && b.manual === true && b.source === 'manual', 'manual grid is marked manual');
  near(b.bpm, 120, 'manual grid BPM');
  near(b.times.length, 61, '120 BPM over 30 s is 61 beats');
  near(b.times[0], 0, 'manual grid starts at the offset');
  near(b.times[60], 30, 'manual grid ends at the duration');
  assert(isManualBeatGrid(s.present), 'isManualBeatGrid reads the flag');
  // Offset nudge regenerates from the same BPM.
  s = historyReducer(s, { type: 'setBeatOffset', offset: 0.25 });
  near(s.present.beats.times[0], 0.25, 'offset nudge moves the first beat');
  near(s.present.beats.times[1], 0.75, 'offset nudge keeps the period');
  near(s.present.beats.bpm, 120, 'offset nudge keeps the BPM');
  assert(s.present.beats.manual === true, 'offset nudge keeps the manual flag');
  // A detected grid stays detected, and its offset survives a reload.
  s = historyReducer(s, { type: 'setBeats', beats: { bpm: 100, times: [0.3, 0.9, 1.5] } });
  assert(s.present.beats.manual === false && s.present.beats.source === 'detected', 'detected grid is not manual');
  const reloaded = historyReducer(state(s.present), { type: 'load', project: s.present });
  assert(reloaded.present.beats.times.length === 3, 'detected grid survives reload');
  // Beat-snap toggle is project state, not an undoable edit target.
  s = historyReducer(s, { type: 'setBeatSnap', on: false });
  assert(s.present.beatSnap === false, 'beat snapping can be switched off');
  s = historyReducer(s, { type: 'setBeatSnap', on: true });
  assert(s.present.beatSnap === true, 'beat snapping can be switched back on');
  // Undo returns to the manual grid.
  s = historyReducer(s, { type: 'undo' });
  s = historyReducer(s, { type: 'undo' });
  s = historyReducer(s, { type: 'undo' });
  assert(s.present.beats && s.present.beats.manual === true, 'undo walks back to the manual grid');
}

console.log('test-beat-grid: all checks passed');
