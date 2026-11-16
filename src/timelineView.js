// Timeline virtualization (gap-build Stream E, PF-03).
//
// The timeline used to render EVERY clip, tick and beat marker on every
// render — a 2-hour project at 60 px/s is thousands of Clip nodes with
// Filmstrip canvases, even though only ~30 seconds are on screen. This
// module is the pure window math; Timeline.jsx keeps the scroll position in
// state (updated from the scroll event, not per frame) and skips rendering
// anything outside the window. Row assignment (stacks / layerRows) still
// runs over all clips — it is plain arithmetic — only the Clip JSX and the
// Filmstrip canvases are skipped.
//
// The window is deliberately generous (one viewport of overscan on each
// side) so a drag that starts just off-screen, a clip straddling the edge,
// and the playhead's follow-scroll never pop in late. Selection, box
// selection and drags are unaffected: a clip that is not rendered cannot be
// clicked, but it is still in the project and still selected — the same
// trade-off every virtualized list makes, and the overscan keeps the
// reachable set a viewport wider than what the user sees.
export const TIMELINE_OVERSCAN_SECONDS = 10;

// Visible time window for a scroll position, in timeline seconds.
export function visibleWindow({ scrollLeft = 0, clientWidth = 1200, pps = 60, overscan = TIMELINE_OVERSCAN_SECONDS } = {}) {
  const start = Math.max(0, scrollLeft / pps - overscan);
  const end = (scrollLeft + clientWidth) / pps + overscan;
  return { start, end };
}

// True when a clip spanning [start, start + len) touches the window at all.
// Zero-length clips never render anyway.
export function clipInWindow(start, len, win) {
  if (!win || !(len > 0)) return true; // no window yet (first paint): render everything
  return start < win.end && start + len > win.start;
}

// Filter a tick/beat/marker time list to the window (ruler + beat lines).
export function timesInWindow(times, win) {
  if (!win) return times || [];
  return (times || []).filter((t) => t >= win.start - 0.5 && t <= win.end + 0.5);
}

// How many clips of a lane would render, for tests / diagnostics.
export function countVisible(clips, win) {
  return (clips || []).filter((c) => clipInWindow(c.start, c.len ?? c.duration ?? 0, win)).length;
}
