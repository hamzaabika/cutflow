// Transition Shifter (P2-09): sync / stagger several transitions with one control.
import assert from 'node:assert';
import { applyTransitionShift, planTransitionShift } from '../src/transitionShift.js';

const clips = [
  { id: 'a', transition: null },
  { id: 'b', transition: { type: 'fade', duration: 0.5 } },
  { id: 'c', transition: { type: 'fade', duration: 1.0 } },
  { id: 'd', transition: { type: 'wipe', duration: 0.3 } },
  { id: 'e', transition: null },
];

// sync: every transitioned clip takes the base duration; the first clip (no
// incoming transition) and the transition-less clip are untouched.
const sync = planTransitionShift(clips, { mode: 'sync', duration: 0.8 });
assert.strictEqual(sync.count, 3, 'sync plans 3 transitions');
assert.deepStrictEqual(sync.durations, [0.8, 0.8, 0.8], 'sync durations equal');
const synced = applyTransitionShift(clips, { mode: 'sync', duration: 0.8 });
assert.strictEqual(synced[0].transition, null, 'first clip untouched');
assert.strictEqual(synced[4].transition, null, 'transition-less clip untouched');
assert.deepStrictEqual(synced.slice(1, 4).map((c) => c.transition.duration), [0.8, 0.8, 0.8], 'sync applied');
assert.strictEqual(synced[3].transition.type, 'wipe', 'sync keeps the transition type');

// stagger: base, base+step, base+2*step across the cut.
const stag = planTransitionShift(clips, { mode: 'stagger', duration: 0.4, step: 0.2 });
assert.deepStrictEqual(stag.durations, [0.4, 0.6, 0.8], 'stagger steps up');
const staggered = applyTransitionShift(clips, { mode: 'stagger', duration: 0.4, step: 0.2 });
assert.deepStrictEqual(staggered.slice(1, 4).map((c) => c.transition.duration), [0.4, 0.6, 0.8], 'stagger applied');

// Clamp: durations stay inside the slider range the inspector writes.
const clamped = planTransitionShift(clips, { mode: 'stagger', duration: 1.9, step: 0.5 });
assert.deepStrictEqual(clamped.durations, [1.9, 2, 2], 'stagger clamps at the max');
const low = planTransitionShift(clips, { mode: 'sync', duration: 0.01 });
assert.deepStrictEqual(low.durations, [0.2, 0.2, 0.2], 'sync clamps at the min');

// Range: from/to limit the plan to a span of the timeline.
const ranged = planTransitionShift(clips, { mode: 'sync', duration: 1, from: 2, to: 3 });
assert.strictEqual(ranged.count, 2, 'range limits the plan');
assert.deepStrictEqual(ranged.updates.map((u) => u.id), ['c', 'd'], 'range picks the right clips');

// No transitions: empty plan, nothing to apply.
assert.strictEqual(planTransitionShift([{ id: 'a' }], { mode: 'sync' }).count, 0, 'no transitions -> empty plan');
assert.deepStrictEqual(applyTransitionShift([], { mode: 'sync' }), [], 'empty list stays empty');

console.log('test-transition-shift: PASS');
