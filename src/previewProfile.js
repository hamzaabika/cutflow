// FB-16 (P1-21) — Preview time-callback profiling.
//
// The Preview.jsx rAF loop calls apply(t) (draw the frame) then onTime(t)
// (push the playhead into React state). Until now nobody had measured what
// that path costs per frame: P2-44 measured rAF deltas and click-to-paint
// latency, not the commit-level split. This module is the recorder: a
// bounded ring buffer (600 frames, ~20 s at 30 fps) of one record per
// played frame, plus interaction latencies recorded by the caller.
//
// Record fields:
//   rafDelta  — ms since the previous rAF tick (frame pacing; ~16.7 ms at
//               60 fps, ~33 ms at 30 fps, larger when the loop starves)
//   applyMs   — the synchronous apply(t) draw cost
//   onTimeMs  — the synchronous onTime(t) dispatch cost (the React setState
//               call itself; the commit happens after, before paint)
//   toPaintMs — ms from the onTime(t) call until the NEXT rAF callback
//               fires, i.e. dispatch + React commit + browser paint, as
//               observed from the loop. It is a to-paint latency, not a
//               pure commit time — React does not expose commit timing to
//               the component, and this file does not pretend otherwise.
//               It ALSO includes one frame interval of pacing by
//               construction: even a zero-cost commit measures ~rafDelta.
//               On this VM (Xvfb/swiftshader, ~16 fps) rafDelta p50 is
//               ~62 ms, so toPaintMs can never read < 100 ms here however
//               cheap the path is — judge the path by onTimeMs/applyMs and
//               judge toPaintMs AGAINST rafDelta (commit+paint adding less
//               than one extra frame), not against an absolute 100 ms.
//
// summary() returns p50/p95/max per field over the recorded frames plus the
// interaction latencies. Restructure the Preview path ONLY if these numbers
// show a cost — the recorder exists to replace the assumption that 60
// React renders/sec are expensive with evidence.
//
// Exposed as window.__fvePreviewProfile (summary/reset/frames) so the live
// suite (scripts/test-preview-profile-live.mjs) can read it over CDP without
// any test-only build flag. Recording is always on: one small object per
// frame, bounded, no allocation growth, no render behaviour change.
const MAX_FRAMES = 600;
const MAX_INTERACTIONS = 50;

const frames = [];
const interactions = [];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function stats(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return { n: 0, p50: null, p95: null, max: null, mean: null };
  return {
    n: nums.length,
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    max: nums[nums.length - 1],
    mean: nums.reduce((a, b) => a + b, 0) / nums.length,
  };
}

export function recordFrame(rec) {
  frames.push({
    rafDelta: rec.rafDelta ?? null,
    applyMs: rec.applyMs ?? null,
    onTimeMs: rec.onTimeMs ?? null,
    toPaintMs: rec.toPaintMs ?? null,
  });
  if (frames.length > MAX_FRAMES) frames.shift();
}

export function recordInteraction(name, ms) {
  interactions.push({ name, ms, at: Date.now() });
  if (interactions.length > MAX_INTERACTIONS) interactions.shift();
}

export function previewProfileSummary() {
  return {
    frames: frames.length,
    rafDelta: stats(frames.map((f) => f.rafDelta)),
    applyMs: stats(frames.map((f) => f.applyMs)),
    onTimeMs: stats(frames.map((f) => f.onTimeMs)),
    toPaintMs: stats(frames.map((f) => f.toPaintMs)),
    interactions: interactions.map((i) => ({ ...i })),
  };
}

export function resetPreviewProfile() {
  frames.length = 0;
  interactions.length = 0;
}

if (typeof window !== 'undefined') {
  window.__fvePreviewProfile = {
    summary: previewProfileSummary,
    reset: resetPreviewProfile,
    frames: () => frames.map((f) => ({ ...f })),
  };
}
