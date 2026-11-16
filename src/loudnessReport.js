// AU-07 — the loudness report's verdict: did the finished file land on its
// mastering target? Pure (no React), so the test can pin it without a DOM.
// report: { target: { id, I, TP } | null, final: { integrated, truePeak, clipped } | null }
// 'on-target': final integrated within ±1 LU of the target and true peak at
//   or under the target ceiling. 'over-tp': the true peak broke the ceiling
//   (clipped). 'off-target': inside the ceiling but off the integrated
//   target. 'measured-only': mastering was off, so there is no target to
//   meet — the numbers are a measurement, not a verdict. null: nothing
//   measured (silence / no audio).
export function loudnessVerdict(report) {
  const fin = report?.final;
  if (!fin || !Number.isFinite(fin.integrated)) return null;
  const target = report?.target;
  if (!target || !Number.isFinite(target.I)) return 'measured-only';
  if (fin.clipped || (Number.isFinite(fin.truePeak) && Number.isFinite(target.TP) && fin.truePeak > target.TP)) return 'over-tp';
  if (Math.abs(fin.integrated - target.I) <= 1) return 'on-target';
  return 'off-target';
}

// B-F19 — the LUFS curve sample at or just before t (the curve is 10 Hz):
// the live readout follows the playhead from the measured curve.
export function sampleAt(curve, t) {
  if (!curve || !curve.samples || !curve.samples.length) return null;
  let lo = null;
  for (const s of curve.samples) {
    if (s.t <= t) lo = s;
    else break;
  }
  return lo || curve.samples[0];
}
