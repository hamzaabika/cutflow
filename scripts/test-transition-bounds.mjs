// Transition boundary behaviour acceptance test (FB-12 · P1-09).
// Run: node scripts/test-transition-bounds.mjs
import assert from 'assert/strict';
import { MIN_TRANSITION, boundarySummary, boundaryUsable, effectiveTransitionDuration, transitionBoundary } from '../src/fx/transitionBounds.js';

// Fake clips: clipLen reads out - in.
const clip = (len, extra = {}) => ({ id: `c${Math.random()}`, in: 0, out: len, transition: { type: 'dissolve', duration: 0.5 }, ...extra });
const pair = (a, b) => [clip(a), clip(b)];

// 0.2 / 0.5 / 1.5 s durations on roomy clips: all fit, effective == requested.
for (const d of [0.2, 0.5, 1.5]) {
  const b = transitionBoundary(pair(6, 6), 1, d);
  assert.equal(b.status, 'ok', `${d}s on 6s clips is ok`);
  assert.equal(b.effective, d);
  assert.ok(boundaryUsable(b));
}
// Too-short clip: 1.5 s requested on a 1 s + 6 s pair clamps to half the short clip.
{
  const b = transitionBoundary(pair(1, 6), 1, 1.5);
  assert.equal(b.status, 'clamped');
  assert.equal(b.effective, 0.5, 'clamped to half of the 1 s clip');
  assert.equal(b.maxAllowed, 0.5);
  assert.ok(boundaryUsable(b));
  assert.equal(boundarySummary(b).kind, 'clamped');
}
// Zero-handle: a 0.3 s clip leaves 0.15 s — under the 0.2 s minimum — so no transition.
{
  const b = transitionBoundary(pair(0.3, 6), 1, 0.5);
  assert.equal(b.status, 'zero-handle');
  assert.equal(b.effective, 0);
  assert.ok(!boundaryUsable(b));
  assert.equal(boundarySummary(b).kind, 'zero-handle');
}
// First clip: no previous clip, no transition possible.
{
  const b = transitionBoundary(pair(6, 6), 0, 0.5);
  assert.equal(b.status, 'first-clip');
  assert.equal(b.effective, 0);
  assert.ok(!boundaryUsable(b));
}
// Last clip: a transition INTO it is an ordinary boundary (it joins the previous clip).
{
  const clips = [clip(6), clip(6), clip(6)];
  const b = transitionBoundary(clips, 2, 0.5);
  assert.equal(b.status, 'ok');
  assert.equal(b.effective, 0.5);
}
// Freeze-frame clip (a 4 s still on the timeline) behaves like any 4 s clip.
{
  const b = transitionBoundary([clip(6), clip(4, { mediaId: 'still-frame' })], 1, 1.5);
  assert.equal(b.status, 'ok');
  assert.equal(b.effective, 1.5);
}
// Mirrored footage (mirror is an effect, not a clip property) clamps like any clip.
{
  const b = transitionBoundary([clip(6), clip(1, { effects: ['mirror'] })], 1, 1.5);
  assert.equal(b.status, 'clamped');
  assert.equal(b.effective, 0.5);
}
// Portrait footage clamps like any clip of the same length.
{
  const b = transitionBoundary([clip(6), clip(1, { mediaWidth: 360, mediaHeight: 640 })], 1, 1.5);
  assert.equal(b.status, 'clamped');
  assert.equal(b.effective, 0.5);
}
// The boundary agrees with the engine's own clamp (transitionDur).
{
  const clips = [clip(1, { transition: null }), clip(6, { transition: { type: 'dissolve', duration: 1.5 } })];
  assert.equal(effectiveTransitionDuration(clips, 1), 0.5, 'engine clamps to 0.5');
  assert.equal(transitionBoundary(clips, 1, 1.5).effective, 0.5, 'boundary agrees');
  const roomy = [clip(6), clip(6, { transition: { type: 'dissolve', duration: 0.5 } })];
  assert.equal(effectiveTransitionDuration(roomy, 1), 0.5);
}
// Invalid requests never produce a transition.
assert.equal(transitionBoundary(pair(6, 6), 1, 0).status, 'zero-handle');
assert.equal(transitionBoundary(pair(6, 6), 1, NaN).status, 'zero-handle');
assert.equal(MIN_TRANSITION, 0.2);
console.log('transition-bounds OK: 0.2/0.5/1.5s, first/last clip, too-short clip, freeze-frame, mirrored/portrait footage');
