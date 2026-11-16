// Keyframe graph helpers (anim.js setKey / moveKey): single-key edits the graph drives, and
// the export-parity check that motionCurves follows moved keys (preview and export sample the
// same stateAt, so a dragged point renders identically in both).
import assert from 'node:assert';
import { addKeys, baseAt, localTime, motionCurves, moveKey, removeKeys, setKey, stateAt } from '../src/anim.js';
import { easeValue } from '../src/fx/easing.js';

const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };
const withKeys = { ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 3, e: 'easeIn' }, { t: 4, v: 1 }] } };

// setKey: adds a key (new segments start Smooth, like addKeys); replacing keeps the easing.
const added = setKey(base, 'scale', 1, 2);
assert.strictEqual(added.keyframes.scale.length, 1, 'setKey adds one key');
assert.strictEqual(added.keyframes.scale[0].e, 'smooth', 'new key starts Smooth');
assert.strictEqual(added.keyframes.scale[0].t, 1, 'setKey stores source time');
const replaced = setKey(withKeys, 'scale', 2, 2.5);
assert.strictEqual(replaced.keyframes.scale.length, 3, 'setKey replace keeps count');
assert.strictEqual(replaced.keyframes.scale.find((k) => k.t === 2).e, 'easeIn', 'replace keeps easing');
assert.strictEqual(replaced.keyframes.scale.find((k) => k.t === 2).v, 2.5, 'replace changes value');
// setKey on a ramped clip stores SOURCE time (local 1 s at 2x speed = source 2 s).
const ramped = { ...base, speed: 2 };
assert.strictEqual(setKey(ramped, 'scale', 1, 2).keyframes.scale[0].t, 2, 'setKey maps local -> source time');

// moveKey: moves time + value, keeps the dragged key's easing, never duplicates.
const moved = moveKey(withKeys, 'scale', 2, 3, 2.5);
assert.strictEqual(moved.keyframes.scale.length, 3, 'moveKey keeps count');
assert.strictEqual(moved.keyframes.scale.find((k) => k.t === 3).e, 'easeIn', 'moved key keeps its easing');
assert.strictEqual(moved.keyframes.scale.find((k) => k.t === 3).v, 2.5, 'moved key takes the new value');
assert.ok(!moved.keyframes.scale.some((k) => k.t === 2), 'source key gone after move');
const sameTime = moveKey(withKeys, 'scale', 2, 2, 2.5);
assert.strictEqual(sameTime.keyframes.scale.length, 3, 'same-time move does not duplicate');
assert.strictEqual(sameTime.keyframes.scale.find((k) => k.t === 2).v, 2.5, 'same-time move changes value');
// Multi-move: two keys dragged together keep their offsets (the graph's shift-drag).
let work = withKeys;
work = { ...work, ...moveKey(work, 'scale', 0, 0.5, 1.5) };
work = { ...work, ...moveKey(work, 'scale', 2, 2.5, 3.5) };
assert.deepStrictEqual(work.keyframes.scale.map((k) => k.t), [0.5, 2.5, 4], 'multi-move keeps order');
assert.strictEqual(work.keyframes.scale.find((k) => k.t === 2.5).e, 'easeIn', 'multi-move keeps easing');
// removeKeys still works at a local time (the graph's Delete).
const removed = removeKeys(withKeys, ['scale'], 2);
assert.strictEqual(removed.keyframes.scale.length, 2, 'removeKeys drops the key at the playhead');

// The graph line is sampled from baseAt: at a key time it returns the key value exactly, and
// mid-segment it follows the arrival key's easing (easeIn here, not linear).
assert.strictEqual(baseAt(withKeys, 2).scale, 3, 'baseAt hits the key value at its time');
assert.ok(Math.abs(baseAt(withKeys, 1).scale - (1 + 2 * easeValue('easeIn', 0.5))) < 1e-9, 'baseAt follows the segment easing');
// Export parity: motionCurves follows the moved keys (sampled from the same stateAt).
const mc = motionCurves({ ...withKeys, keyframes: moved.keyframes }, 4, 30).s;
const at3 = mc.reduce((b, p) => (Math.abs(p[0] - 3) < Math.abs(b[0] - 3) ? p : b));
assert.ok(Math.abs(at3[1] - 2.5) < 0.02, `export curve follows the moved key (${at3[1]})`);
assert.strictEqual(stateAt(withKeys, 2, 4).transform.scale, 3, 'stateAt at key time is exact');
assert.strictEqual(localTime(withKeys, 2), 2, 'localTime identity at 1x');

console.log('KEYFRAME GRAPH OK — setKey/moveKey/multi-move/delete + baseAt sampling + export parity');
