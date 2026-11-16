// Playback performance tracing (A-15). Opt-in and local only: nothing is
// sent anywhere, and sampling is zero-cost when off (Preview checks the
// flag before touching a video element).
//
// Opt in from Settings → Performance ("Playback performance tracing"), or
// from the console / a test rig:
//   localStorage.setItem('cutflow:perfTrace', '1')   // then reload, or
//   window.__fvePerfTraceEnable(true)               // live, no reload
// Read it live at window.__fvePerfTrace:
//   { enabled, total, dropped, corrupted, samples: [{at, total, dropped}],
//     seeks: [ms, ...] }
// total/dropped come from the lead video element's
// getVideoPlaybackQuality() — frames actually decoded vs dropped — sampled
// once a second while playing. seeks are the measured seek latencies:
// time from the seek request to the frame landing on screen.
const KEY = 'cutflow:perfTrace';

export function isPerfTraceEnabled() {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1')
      || (typeof window !== 'undefined' && window.__fvePerfTrace?.enabled === true);
  } catch {
    return false;
  }
}

export function setPerfTraceEnabled(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (typeof window !== 'undefined' && window.__fvePerfTrace) window.__fvePerfTrace.enabled = !!on;
}

export function createPerfTrace() {
  return { enabled: isPerfTraceEnabled(), total: 0, dropped: 0, corrupted: 0, samples: [], seeks: [] };
}

export function samplePlaybackQuality(trace, el) {
  if (!trace || !el || typeof el.getVideoPlaybackQuality !== 'function') return;
  let q;
  try { q = el.getVideoPlaybackQuality(); } catch { return; }
  if (!q) return;
  trace.total = q.totalVideoFrames || 0;
  trace.dropped = q.droppedVideoFrames || 0;
  trace.corrupted = q.corruptedVideoFrames || 0;
  trace.samples.push({ at: Date.now(), total: trace.total, dropped: trace.dropped });
  if (trace.samples.length > 600) trace.samples.splice(0, trace.samples.length - 600);
}

export function noteSeek(trace, ms) {
  if (!trace || !Number.isFinite(ms)) return;
  trace.seeks.push(Math.round(ms * 10) / 10);
  if (trace.seeks.length > 120) trace.seeks.splice(0, trace.seeks.length - 120);
}

// Snapshot for display / tests: the latest sample plus seek stats.
export function perfTraceSummary(trace) {
  if (!trace) return null;
  const seeks = trace.seeks || [];
  const sorted = [...seeks].sort((a, b) => a - b);
  return {
    enabled: !!trace.enabled,
    total: trace.total || 0,
    dropped: trace.dropped || 0,
    corrupted: trace.corrupted || 0,
    droppedPct: trace.total ? Math.round((100 * trace.dropped) / trace.total * 10) / 10 : 0,
    samples: (trace.samples || []).length,
    seeks: seeks.length,
    seekMedianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    seekMaxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}
