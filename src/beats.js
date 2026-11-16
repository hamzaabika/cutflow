// Beat cuts (v1.1.9), the renderer half: what the timeline and toolbar need from the
// beat grid the main process heard in the soundtrack (electron/beats.cjs). The grid
// itself lives on the project as { bpm, times } (timeline seconds); the pure helpers
// here decide which beats fall inside a clip and which clip "Split at beats" cuts —
// the store does the cutting (splitClipAtBeats in src/store.js).
import { MIN_CLIP, videoClipAt, videoLayout } from './store.js';

export const beatsOf = (project) => (project && project.beats && Array.isArray(project.beats.times) ? project.beats.times : []);

// The beats that can actually cut a clip spanning [start, end]: strictly inside,
// with the same MIN_CLIP breathing room at both edges the split itself enforces —
// a beat a hair from an edge would leave a sliver piece and is skipped everywhere
// (button state, the cut itself) by construction, not by luck.
export function interiorBeats(times, start, end) {
  return (times || []).filter((t) => t - start >= MIN_CLIP && end - t >= MIN_CLIP);
}

// The clip "Split at beats" acts on, mirroring the toolbar's split targeting:
// the selected main-track clip first, else the main-track clip under the playhead.
// Returns { clip, start, end, times } or null when there is nothing to cut.
export function beatSplitTarget(project, time, selection) {
  let hit = null;
  if (selection && selection.track === 'video' && selection.id) {
    hit = videoLayout(project.videoClips).find((l) => l.clip.id === selection.id) || null;
  }
  if (!hit) hit = videoClipAt(project, time);
  if (!hit || hit.clip.gap) return null;
  const times = interiorBeats(beatsOf(project), hit.start, hit.end);
  return times.length ? { clip: hit.clip, start: hit.start, end: hit.end, times } : null;
}

export const formatBpm = (bpm) => (bpm ? `${Math.round(bpm)} BPM` : '');

// ---- Beat grid (P2-22, AU-08) ----
// A regular tempo grid: beats at offset + k·(60/bpm), over [from, to].
// offset is the first beat's timeline position (negative = the grid started
// before the timeline). BPM is clamped to the detector's own 40–240 range.
export const BEAT_BPM_MIN = 40;
export const BEAT_BPM_MAX = 240;
export const clampBpm = (bpm) => {
  const n = Number(bpm);
  return Math.min(BEAT_BPM_MAX, Math.max(BEAT_BPM_MIN, Number.isFinite(n) ? n : 120));
};

export function beatGrid(bpm, offset = 0, from = 0, to = 0) {
  const b = clampBpm(bpm);
  const period = 60 / b;
  const off = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const times = [];
  if (to < from) return times;
  let k = Math.ceil((from - off) / period - 1e-9);
  for (let t = off + k * period; t <= to + 1e-9 && times.length < 100000; t += period) {
    times.push(Math.round(t * 1000) / 1000);
    k += 1;
  }
  return times;
}

// The beat nearest to t within tol seconds (snapping), else t unchanged.
export function snapToBeat(t, times, tol = 0.15) {
  let best = t;
  let bestD = Infinity;
  for (const b of times || []) {
    const d = Math.abs(b - t);
    if (d <= tol && d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// Tap tempo: BPM from the median tap interval (robust to one stray tap).
// Returns null with fewer than two taps or an out-of-range median.
export function tapTempo(taps) {
  if (!Array.isArray(taps) || taps.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < taps.length; i += 1) {
    const g = taps[i] - taps[i - 1];
    if (g > 0.05 && g < 3) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  const bpm = 60 / med;
  if (bpm < BEAT_BPM_MIN || bpm > BEAT_BPM_MAX) return null;
  return Math.round(bpm * 10) / 10;
}

// Is the project's grid a manual override (user-set BPM/offset) rather than
// a detected one? A manual grid is regenerated from its BPM, never re-heard.
export const isManualBeatGrid = (project) => !!(project && project.beats && project.beats.manual);
