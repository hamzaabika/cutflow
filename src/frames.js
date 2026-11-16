// Frame timebase (P1-04, Frame-Accurate Editing Engine): the single source of
// truth for frame-accurate editing. Every timeline time the user touches —
// playhead, trims, splits, drags, seeks — is quantized to a whole frame of
// the project rate, so a cut made in the preview lands on the same frame in
// the export. Rates are stored as exact rationals (24000/1001, not 23.976)
// so long timelines do not drift: 23.976 as a decimal is 0.000024 fps off,
// which is a full frame every ~11.5 hours; the rational is exact.
//
// What this module deliberately does NOT do: drop-frame timecode. formatTime
// still shows centiseconds; frame-accurate timecode display is a separate
// piece of work if Hamza ever asks for it.
export const FRAME_RATES = [
  { id: '23.976', label: '23.976', fps: 24000 / 1001 },
  { id: '24', label: '24', fps: 24 },
  { id: '25', label: '25', fps: 25 },
  { id: '29.97', label: '29.97', fps: 30000 / 1001 },
  { id: '30', label: '30', fps: 30 },
  { id: '50', label: '50', fps: 50 },
  { id: '59.94', label: '59.94', fps: 60000 / 1001 },
  { id: '60', label: '60', fps: 60 },
];

// The project's effective rate: stored fps when sane, 30 otherwise. Old
// projects store an integer; NTSC projects store the exact rational.
export function effectiveFps(project) {
  const f = Number(project && project.fps);
  return Number.isFinite(f) && f > 0 ? f : 30;
}

// Snap a time to the nearest whole frame at the given rate. Idempotent:
// quantizing an already on-grid time returns it unchanged (up to float
// noise far below a microsecond).
export function quantize(t, fps) {
  const f = Number(fps) || 30;
  return Math.round(t * f) / f;
}

export function toFrame(t, fps) {
  return Math.round(t * (Number(fps) || 30));
}

export function fromFrame(n, fps) {
  return n / (Number(fps) || 30);
}

// B-F08: has the playhead crossed into a new frame since prevT? The
// preview's rAF loop runs at display rate (60/s) while the project only
// has fps frames per second — publishing the time to React on every tick
// re-rendered the whole app 60×/s for a timecode that only changes 30×/s.
// Callers publish onTime() only when this is true (plus on seeks, where
// the caller resets prevT). A backwards jump (a seek) always counts.
export function isNewFrame(prevT, t, fps) {
  const f = Number(fps) || 30;
  if (!Number.isFinite(prevT)) return true;
  if (t < prevT - 1e-9) return true;
  return Math.floor(t * f) !== Math.floor(prevT * f);
}

export function frameDuration(fps) {
  return 1 / (Number(fps) || 30);
}

// The nearest supported rate within 0.02 fps, or null. The tolerance is
// deliberately tighter than the 23.976/24 and 29.97/30 gaps (0.024 and
// 0.030), so a value can only ever snap to the rate it was meant to be:
// probe returns exact rationals, and a hand-typed 29.97 lands on
// 30000/1001, never on 30.
export function nearestFrameRate(fps) {
  const f = Number(fps);
  if (!Number.isFinite(f) || f <= 0) return null;
  let best = null;
  let bestD = Infinity;
  for (const r of FRAME_RATES) {
    const d = Math.abs(r.fps - f);
    if (d < bestD) { bestD = d; best = r.fps; }
  }
  return bestD <= 0.02 ? best : null;
}

// Display label for a rate: the exact NTSC label when it matches one,
// otherwise the value rounded to two decimals (24, 29.97, 59.94 — never
// the raw double 29.97002997002997).
export function fpsLabel(fps) {
  const f = Number(fps);
  if (!Number.isFinite(f) || f <= 0) return '30';
  const known = FRAME_RATES.find((r) => Math.abs(r.fps - f) < 0.001);
  if (known) return known.label;
  return String(Math.round(f * 100) / 100);
}
