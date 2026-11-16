// Transition boundary behaviour (FB-12 · P1-09).
//
// The engine clamps a transition to half of either neighbouring clip at use
// time (transitionDur in src/store.js), but until now nothing told the user
// when that happened — a 1.5 s transition on a 0.4 s clip silently became
// 0.2 s, and a zero-handle clip silently got no transition at all. This
// module is the one place that decides what a requested duration means at a
// boundary, so the inspector, the panel and the tests all agree:
//
//   status 'ok'          — the requested duration fits, effective == requested.
//   status 'clamped'     — the requested duration exceeds half of the shorter
//                          neighbour; effective is the largest fitting value.
//   status 'zero-handle' — even the shortest transition (0.2 s) does not fit:
//                          half of the shorter neighbour is < 0.2 s, so the
//                          engine renders no transition (effective 0).
//   status 'first-clip'  — clip i is the first clip: no previous clip exists,
//                          so no transition can join it (effective 0).
//
// Freeze-frame clips (a still image on the timeline), mirrored footage
// (mirror is an effect, not a clip property) and portrait footage (media
// narrower than tall) need NO special case: the clamp is purely a function
// of the two neighbours' lengths, so they behave exactly like any other
// clip — the test pins that, so a boundary can never freeze a frame or
// produce an artifact for those footages.
import { clipLen, transitionDur } from '../store.js';

export const MIN_TRANSITION = 0.2;

// The boundary decision for a transition of `requested` seconds into clip i.
export function transitionBoundary(clips, i, requested) {
  const req = Number(requested);
  if (!Number.isFinite(req) || req <= 0) {
    return { status: 'zero-handle', requested: req, effective: 0, maxAllowed: 0, shortClip: null };
  }
  if (i <= 0 || !clips[i] || !clips[i - 1]) {
    return { status: 'first-clip', requested: req, effective: 0, maxAllowed: 0, shortClip: null };
  }
  const a = clipLen(clips[i]);
  const b = clipLen(clips[i - 1]);
  const maxAllowed = Math.max(0, Math.min(a, b) / 2);
  const shortClip = a <= b ? clips[i] : clips[i - 1];
  if (maxAllowed < MIN_TRANSITION) {
    return { status: 'zero-handle', requested: req, effective: 0, maxAllowed, shortClip };
  }
  if (req > maxAllowed) {
    return { status: 'clamped', requested: req, effective: maxAllowed, maxAllowed, shortClip };
  }
  return { status: 'ok', requested: req, effective: req, maxAllowed, shortClip: null };
}

// The effective duration the engine will actually use (transitionDur's rule,
// expressed through the boundary so callers never re-derive the clamp).
export function effectiveTransitionDuration(clips, i) {
  return transitionDur(clips, i);
}

// True when the boundary leaves the transition usable (ok or clamped).
export const boundaryUsable = (b) => b.status === 'ok' || b.status === 'clamped';

// Short human-readable account of a boundary, for the inspector note.
export function boundarySummary(b) {
  switch (b.status) {
    case 'ok': return { kind: 'ok' };
    case 'clamped': return { kind: 'clamped', effective: b.effective };
    case 'zero-handle': return { kind: 'zero-handle', maxAllowed: b.maxAllowed };
    case 'first-clip': return { kind: 'first-clip' };
    default: return { kind: 'zero-handle', maxAllowed: 0 };
  }
}
