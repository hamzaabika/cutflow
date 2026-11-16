// Keyframe actions (P2-08): copy/paste, mirror, reverse, clone, shift,
// randomize, align, setKeysEase — bulk edits that keep keys glued to the
// same picture on ramped clips and never corrupt the curve.
import assert from 'node:assert';
import {
  alignKeys, baseAt, cloneKeys, copyKeyframes, getKeyframeClipboard, mirrorKeys,
  pasteKeyframes, randomizeKeys, reverseKeys, setKeysEase, shiftKeys, stateAt,
} from '../src/anim.js';

const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };
const withKeys = {
  ...base,
  keyframes: {
    scale: [{ t: 0, v: 1 }, { t: 2, v: 3, e: 'easeIn' }, { t: 4, v: 1 }],
    x: [{ t: 1, v: 0 }, { t: 3, v: 0.5 }],
  },
};
const times = (clip, p) => (clip.keyframes?.[p] || []).map((k) => k.t);
const vals = (clip, p) => (clip.keyframes?.[p] || []).map((k) => k.v);

// mirror: times reflect about the clip midpoint (len 4 -> pivot 2); values + easing travel.
const m = mirrorKeys(withKeys, ['scale']);
assert.deepStrictEqual(times({ ...withKeys, ...m }, 'scale'), [0, 2, 4], 'mirror keeps symmetric times');
assert.strictEqual({ ...withKeys, ...m }.keyframes.scale.find((k) => k.t === 0).v, 1, 'mirror: key at 0 keeps its value');
assert.strictEqual({ ...withKeys, ...m }.keyframes.scale.find((k) => k.t === 2).e, 'easeIn', 'mirror keeps easing');
const m2 = mirrorKeys({ ...base, keyframes: { x: [{ t: 1, v: 0.1 }, { t: 3, v: 0.3 }] } }, ['x'], 2);
assert.deepStrictEqual(times({ ...base, ...m2 }, 'x'), [1, 3], 'mirror about 2 swaps 1<->3');
assert.deepStrictEqual(vals({ ...base, ...m2 }, 'x'), [0.3, 0.1], 'mirror swaps values with times');

// reverse: times stay, values reverse.
const r = reverseKeys(withKeys, ['scale']);
assert.deepStrictEqual(times({ ...withKeys, ...r }, 'scale'), [0, 2, 4], 'reverse keeps times');
assert.deepStrictEqual(vals({ ...withKeys, ...r }, 'scale'), [1, 3, 1], 'reverse flips values (symmetric here)');
const r2 = reverseKeys({ ...base, keyframes: { scale: [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: 3 }] } }, ['scale']);
assert.deepStrictEqual(vals({ ...base, ...r2 }, 'scale'), [3, 2, 1], 'reverse flips asymmetric values');
assert.strictEqual(stateAt({ ...base, ...r2 }, 0, 4).transform.scale, 3, 'reversed value renders at t=0');

// clone: duplicates shifted +1s; collisions skipped, out-of-range skipped.
const cl = cloneKeys(withKeys, ['x'], 0.5);
assert.deepStrictEqual(times({ ...withKeys, ...cl }, 'x'), [1, 1.5, 3, 3.5], 'clone duplicates shifted');
const cl2 = cloneKeys(withKeys, ['scale'], 0.5);
assert.deepStrictEqual(times({ ...withKeys, ...cl2 }, 'scale'), [0, 0.5, 2, 2.5, 4], 'clone skips the copy past the end (4.5)');

// shift: moves all keys; keys pushed out are dropped, the rest keep values.
const sh = shiftKeys(withKeys, ['scale'], -1);
assert.deepStrictEqual(times({ ...withKeys, ...sh }, 'scale'), [1, 3], 'shift drops the key pushed out');
assert.deepStrictEqual(vals({ ...withKeys, ...sh }, 'scale'), [3, 1], 'shift keeps values');

// copy/paste: paste lands the first key at the playhead, easing travels.
const copied = copyKeyframes(withKeys, ['scale']);
assert.ok(copied && copied.version === 1, 'copy returns clipboard data');
assert.strictEqual(getKeyframeClipboard(), copied, 'copy stores the module clipboard');
const target = { ...base, in: 0, out: 4, speed: 1 };
const pasted = pasteKeyframes(target, copied, 1);
assert.deepStrictEqual(times({ ...target, ...pasted }, 'scale'), [1, 3, 5].filter((t) => t <= 4), 'paste lands first key at playhead, drops past end');
const pastedClip = { ...target, ...pasted };
assert.strictEqual(pastedClip.keyframes.scale.find((k) => k.t === 3).e, 'easeIn', 'paste carries easing');
assert.strictEqual(pasteKeyframes(target, { version: 99, props: {} }, 0), null, 'bad clipboard rejected');
assert.strictEqual(pasteKeyframes(target, null, 0), null, 'null clipboard rejected');
// paste merge replaces a key at the same time instead of duplicating.
const merged = pasteKeyframes({ ...withKeys }, copied, 0);
assert.strictEqual(times({ ...withKeys, ...merged }, 'scale').length, 3, 'merge paste keeps key count');

// randomize: seeded (repeatable), values stay in range, times untouched.
const ra1 = randomizeKeys(withKeys, ['scale'], 0.5, 7);
const ra2 = randomizeKeys(withKeys, ['scale'], 0.5, 7);
assert.deepStrictEqual(ra1, ra2, 'same seed -> same jitter');
assert.deepStrictEqual(times({ ...withKeys, ...ra1 }, 'scale'), [0, 2, 4], 'randomize keeps times');
assert.ok({ ...withKeys, ...ra1 }.keyframes.scale.every((k) => k.v >= 0.05 && k.v <= 4), 'randomize stays in range');
assert.ok(JSON.stringify(ra1) !== JSON.stringify(withKeys.keyframes), 'randomize changes something');

// align: keys near the playhead snap onto it.
const al = alignKeys({ ...base, keyframes: { x: [{ t: 0.9, v: 0 }, { t: 1.05, v: 0.2 }, { t: 3, v: 0.4 }], y: [{ t: 1.1, v: 0.1 }] } }, ['x', 'y'], 1, 0.15);
assert.deepStrictEqual(times({ ...base, ...al }, 'x'), [1, 3], 'align snaps near keys together');
assert.ok(Math.abs(({ ...base, ...al }.keyframes.y[0].t) - 1) < 1e-9, 'align snaps the y key too');

// setKeysEase: writes easing onto the keys at the playhead, clears with 'linear'.
const se = setKeysEase(withKeys, ['scale'], 2, 'out');
assert.strictEqual({ ...withKeys, ...se }.keyframes.scale.find((k) => k.t === 2).e, 'out', 'setKeysEase writes easing');
const se2 = setKeysEase({ ...withKeys, ...se }, ['scale'], 2, 'linear');
assert.strictEqual({ ...withKeys, ...se2 }.keyframes.scale.find((k) => k.t === 2).e, undefined, 'linear clears easing');

// Ramped clip: actions stay glued to the picture (local 1s at 2x = source 2s).
const ramped = { ...base, speed: 2, keyframes: { scale: [{ t: 0, v: 1 }, { t: 2, v: 2 }, { t: 4, v: 1 }] } };
const rm = mirrorKeys(ramped, ['scale']);
assert.deepStrictEqual(times({ ...ramped, ...rm }, 'scale'), [0, 2, 4], 'mirror on ramped clip keeps source times');
const rp = pasteKeyframes({ ...base, speed: 2 }, copyKeyframes(ramped, ['scale']), 0.5);
assert.ok(rp && times({ ...base, speed: 2, ...rp }, 'scale')[0] === 1, 'paste on ramped clip maps local 0.5 -> source 1');

console.log('test-keyframe-actions: PASS');
